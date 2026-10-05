import { Alert, Badge, Box, Button, Center, Group, Loader, SegmentedControl, Select, Stack, Switch, Text, Tooltip } from '@mantine/core';
import { IconClipboardCheck, IconKeyboard, IconMaximize, IconPlugConnectedX, IconScreenShare } from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { ClipboardBridge } from './clipboard';
import { FRAME, type ClipboardBody, type FrameEndFrame, type HelloBody, type RemoteDisplay, type TileFrame } from './protocol';
import { shouldCapture, toRemotePoint, wheelUnits } from './inputMap';
import { useRemoteSession, type SessionStatus } from './useRemoteSession';

type QualityPreset = 'alta' | 'media' | 'baixa';

const PRESETS: Record<QualityPreset, { quality: number; scale: number; maxFps: number }> = {
  alta: { quality: 80, scale: 1, maxFps: 20 },
  media: { quality: 60, scale: 1, maxFps: 15 },
  baixa: { quality: 40, scale: 0.75, maxFps: 10 },
};

interface DecodedTile {
  tile: TileFrame;
  bitmap: ImageBitmap;
}

function statusText(status: SessionStatus, consent: string | null): { label: string; color: string } {
  if (status.kind === 'creating') return { label: 'Abrindo sessão', color: 'gray' };
  if (status.kind === 'failed') return { label: 'Falhou', color: 'red' };
  if (status.kind === 'ended') return { label: 'Encerrada', color: 'gray' };
  if (consent === 'waiting') return { label: 'Aguardando o usuário aceitar', color: 'yellow' };
  switch (status.phase) {
    case 'connecting':
      return { label: 'Conectando', color: 'gray' };
    case 'waiting-agent':
      return { label: 'Aguardando a máquina', color: 'yellow' };
    case 'connected':
      return { label: 'Conectado', color: 'teal' };
    default:
      return { label: 'Encerrada', color: 'gray' };
  }
}

type KeyboardLock = { keyboard?: { lock?: () => Promise<void> } };

export function RemoteViewerPage() {
  const params = useParams();
  const agentId = Number(params.agentId);
  const [search] = useSearchParams();
  const ticket = search.get('chamado');
  const options = useMemo(
    () => ({ channels: ['desktop' as const], viewOnly: search.get('visualizar') === '1', ticketId: ticket ? Number(ticket) : null }),
    [search, ticket],
  );

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pending = useRef<Promise<DecodedTile | null>[]>([]);
  const pressed = useRef(new Set<string>());
  const [hello, setHello] = useState<HelloBody | null>(null);
  const [displays, setDisplays] = useState<RemoteDisplay[]>([]);
  const [activeDisplay, setActiveDisplay] = useState(0);
  const [preset, setPreset] = useState<QualityPreset>('media');
  const [viewOnly, setViewOnly] = useState(options.viewOnly);
  const [consent, setConsent] = useState<string | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [firstFrame, setFirstFrame] = useState(false);
  // Area de transferencia automatica (contrato, secao 6): o envio passa pela conexao atual.
  const outbox = useRef<(body: ClipboardBody) => void>(() => undefined);
  const bridgeRef = useRef<ClipboardBridge | null>(null);
  // So nos eventos e efeitos (nunca durante a renderizacao).
  const bridge = () => {
    bridgeRef.current ??= new ClipboardBridge((body) => outbox.current(body));
    return bridgeRef.current;
  };
  // Ctrl+V: espera o evento paste para mandar o texto antes das teclas.
  const paste = useRef<{ waiting: boolean; ignoreUp: boolean; timer: number | undefined }>({ waiting: false, ignoreUp: false, timer: undefined });

  const onTile = useCallback((tile: TileFrame) => {
    const bytes = new Uint8Array(tile.jpeg.length);
    bytes.set(tile.jpeg);
    pending.current.push(
      createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }))
        .then((bitmap) => ({ tile, bitmap }))
        .catch(() => null),
    );
  }, []);

  const onFrameEnd = useCallback(async (end: FrameEndFrame) => {
    const decoded = await Promise.all(pending.current.splice(0));
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    if (canvas.width !== end.width || canvas.height !== end.height) {
      canvas.width = end.width;
      canvas.height = end.height;
    }
    for (const item of decoded) {
      if (!item) continue;
      ctx.drawImage(item.bitmap, item.tile.x, item.tile.y);
      item.bitmap.close();
    }
    setFirstFrame(true);
  }, []);

  const { status, connection } = useRemoteSession(agentId, options, {
    onHello: (h) => {
      bridge().enabled = h.features.includes('clipboard-text');
      setHello(h);
      setDisplays(h.displays);
      setActiveDisplay(h.active);
    },
    onDisplays: (d, a) => {
      setDisplays(d);
      setActiveDisplay(a);
    },
    onTile,
    onFrameEnd,
    onConsent: setConsent,
    onClipboard: (body) => void bridge().fromRemote(body),
    onFilesCopied: () => undefined,
    onError: (_code, message) => setAgentError(message),
  });

  const connected = status.kind === 'open' && status.phase === 'connected';

  useEffect(() => {
    outbox.current = (body) => {
      if (!viewOnly) connection.current?.sendJson(FRAME.clipboard, body);
    };
  }, [connection, viewOnly]);

  // Ajustes de imagem: enviados no HELLO e a cada mudanca.
  useEffect(() => {
    if (!connected || !hello) return;
    connection.current?.sendJson(FRAME.settings, { ...PRESETS[preset], display: activeDisplay });
  }, [connected, hello, preset, activeDisplay, connection]);

  const display = displays.find((d) => d.id === activeDisplay) ?? displays[0];
  const send = (type: number, body: unknown) => {
    if (!viewOnly) connection.current?.sendJson(type, body);
  };

  const pointer = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!display || viewOnly) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const point = toRemotePoint(event.clientX - rect.left, event.clientY - rect.top, rect, display);
    send(FRAME.mouse, { ...point, buttons: event.buttons });
  };

  const sendPasteKeys = () => {
    window.clearTimeout(paste.current.timer);
    paste.current.waiting = false;
    send(FRAME.key, { code: 'KeyV', down: true });
    send(FRAME.key, { code: 'KeyV', down: false });
  };

  const key = (event: KeyboardEvent<HTMLCanvasElement>, down: boolean) => {
    if (viewOnly || !shouldCapture(event.nativeEvent)) return;
    if (down) void bridge().flushPending();
    if (event.code === 'KeyV' && bridge().enabled) {
      if (down && paste.current.waiting) {
        event.preventDefault();
        return;
      }
      if (down && (event.ctrlKey || event.metaKey)) {
        // Sem preventDefault: o navegador entrega o texto local no evento paste, e as teclas vao depois dele.
        paste.current = { waiting: true, ignoreUp: true, timer: window.setTimeout(() => {
          if (paste.current.waiting) sendPasteKeys();
        }, 300) };
        return;
      }
      if (!down && paste.current.ignoreUp) {
        event.preventDefault();
        paste.current.ignoreUp = false;
        return;
      }
    }
    event.preventDefault();
    if (down) pressed.current.add(event.code);
    else pressed.current.delete(event.code);
    send(FRAME.key, { code: event.code, down });
  };

  const onPaste = async (event: ClipboardEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    if (viewOnly) return;
    const text = event.clipboardData.getData('text/plain');
    await bridge().local(text);
    if (paste.current.waiting) sendPasteKeys();
  };

  // Teclas presas: ao perder o foco, solta o que estava pressionado.
  const releaseAll = () => {
    for (const code of pressed.current) send(FRAME.key, { code, down: false });
    pressed.current.clear();
  };

  const wheel = (event: WheelEvent<HTMLCanvasElement>) => {
    send(FRAME.wheel, { dx: wheelUnits(event.deltaX, event.deltaMode), dy: wheelUnits(event.deltaY, event.deltaMode) });
  };

  const fullscreen = async () => {
    await containerRef.current?.requestFullscreen();
    // Keyboard Lock (Chrome e Edge em tela cheia): atalhos do sistema vao para a maquina remota.
    await (navigator as Navigator & KeyboardLock).keyboard?.lock?.().catch(() => undefined);
  };

  const state = statusText(status, consent);
  const hostname = status.kind === 'open' ? status.session.hostname : '';
  const message = status.kind === 'failed' || status.kind === 'ended' ? status.message : null;

  useEffect(() => {
    document.title = hostname ? `${hostname} - Acesso remoto` : 'Acesso remoto';
  }, [hostname]);

  return (
    <Stack gap={0} h="100vh" bg="dark.8">
      <Group justify="space-between" px="sm" py={6} wrap="nowrap" bg="dark.7">
        <Group gap="sm" wrap="nowrap">
          <IconScreenShare size={18} aria-hidden />
          <Text fw={600} size="sm">
            {hostname || 'Acesso remoto'}
          </Text>
          <Badge color={state.color} variant="light" aria-live="polite">
            {state.label}
          </Badge>
        </Group>
        <Group gap="xs" wrap="nowrap">
          {displays.length > 1 && (
            <Select
              aria-label="Monitor"
              size="xs"
              w={160}
              data={displays.map((d) => ({ value: String(d.id), label: `${d.name || 'Monitor'} ${d.w}x${d.h}` }))}
              value={String(activeDisplay)}
              onChange={(v) => v !== null && setActiveDisplay(Number(v))}
              allowDeselect={false}
            />
          )}
          <SegmentedControl
            size="xs"
            aria-label="Qualidade"
            value={preset}
            onChange={setPreset}
            data={[
              { value: 'alta', label: 'Alta' },
              { value: 'media', label: 'Média' },
              { value: 'baixa', label: 'Baixa' },
            ]}
          />
          {hello?.features.includes('clipboard-text') && (
            <Tooltip label="Área de transferência sincronizada: copie de um lado e cole do outro (Ctrl+V)">
              <IconClipboardCheck size={18} aria-label="Área de transferência sincronizada" role="img" />
            </Tooltip>
          )}
          <Switch size="xs" label="Somente visualizar" checked={viewOnly} onChange={(e) => setViewOnly(e.currentTarget.checked)} />
          {hello?.features.includes('cad') && (
            <Button size="xs" variant="default" leftSection={<IconKeyboard size={14} />} onClick={() => send(FRAME.cad, {})} disabled={viewOnly}>
              Ctrl+Alt+Del
            </Button>
          )}
          <Tooltip label="Tela cheia">
            <Button size="xs" variant="default" onClick={() => void fullscreen()} aria-label="Tela cheia">
              <IconMaximize size={14} />
            </Button>
          </Tooltip>
          <Button size="xs" color="red" leftSection={<IconPlugConnectedX size={14} />} onClick={() => {
              connection.current?.close();
              window.close();
            }}>
            Encerrar
          </Button>
        </Group>
      </Group>
      <Box ref={containerRef} style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <canvas
          ref={canvasRef}
          tabIndex={0}
          aria-label={`Tela de ${hostname}`}
          data-testid="remote-canvas"
          style={{ maxWidth: '100%', maxHeight: '100%', outline: 'none', cursor: 'default', display: firstFrame ? 'block' : 'none' }}
          onPointerMove={pointer}
          onPointerDown={(e) => {
            e.currentTarget.focus();
            void bridge().flushPending();
            pointer(e);
          }}
          onFocus={() => {
            if (!viewOnly) void bridge().readOnFocus();
          }}
          onPaste={(e) => void onPaste(e)}
          onPointerUp={pointer}
          onWheel={wheel}
          onKeyDown={(e) => key(e, true)}
          onKeyUp={(e) => key(e, false)}
          onBlur={releaseAll}
          onContextMenu={(e) => e.preventDefault()}
        />
        {!firstFrame && (
          <Center pos="absolute" inset={0}>
            {message ? (
              <Alert color={status.kind === 'failed' ? 'red' : 'gray'} title="Acesso remoto" maw={480}>
                {message}
              </Alert>
            ) : (
              <Stack align="center" gap="xs">
                <Loader color="gray" />
                <Text c="dimmed" size="sm">
                  {state.label}
                </Text>
              </Stack>
            )}
          </Center>
        )}
        {firstFrame && message && (
          <Alert pos="absolute" top={12} color="gray" title="Acesso remoto">
            {message}
          </Alert>
        )}
        {agentError && (
          <Alert pos="absolute" bottom={12} color="red" withCloseButton onClose={() => setAgentError(null)}>
            {agentError}
          </Alert>
        )}
      </Box>
    </Stack>
  );
}
