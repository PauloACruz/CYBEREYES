import { Alert, Anchor, Badge, Box, Button, Center, Drawer, Group, Loader, SegmentedControl, Select, Stack, Switch, Text, Tooltip } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { IconClipboardCheck, IconFolders, IconKeyboard, IconMaximize, IconPlugConnectedX, IconScreenShare, IconVolume, IconVolumeOff } from '@tabler/icons-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { remoteFilesApi } from '../../api/remote';
import { PERMISSIONS } from '../../api/types';
import { hasPermission } from '../../auth/permissions';
import { useMe } from '../../auth/useMe';
import { formatBytes } from '../../lib/format';
import { AudioPlayer } from './audio';
import { ClipboardBridge } from './clipboard';
import { CursorShapes, cssCursor, placeCursor, type CursorShape } from './cursor';
import { FilesPanel } from './FilesPanel';
import { RdpViewer } from './RdpViewer';
import { useTransfers } from './useTransfers';
import { FRAME, type ClipboardBody, type CursorBody, type FilesCopiedBody, type FrameEndFrame, type HelloBody, type RemoteDisplay, type TileFrame } from './protocol';
import { Coalescer, shouldCapture, toRemotePoint, wheelUnits } from './inputMap';
import { useRemoteSession, type SessionStatus } from './useRemoteSession';

type QualityPreset = 'alta' | 'media' | 'baixa';

// Qualidade inicial e limite de quadros por segundo; o agente baixa a qualidade sozinho quando a rede aperta e
// refina a tela parada (contrato, secao 5.3).
const PRESETS: Record<QualityPreset, { quality: number; scale: number; maxFps: number }> = {
  alta: { quality: 80, scale: 1, maxFps: 30 },
  media: { quality: 60, scale: 1, maxFps: 24 },
  baixa: { quality: 40, scale: 0.75, maxFps: 15 },
};

interface DecodedTile {
  tile: TileFrame;
  bitmap: ImageBitmap;
}

interface MouseBody {
  x: number;
  y: number;
  buttons: number;
}

interface WheelBody {
  dx: number;
  dy: number;
}

// Tecnico parado ha este tempo e cursor remoto longe do ponteiro local: outra pessoa (ou um programa) moveu o
// cursor, e ele aparece desenhado sobre a tela.
const REMOTE_MOVED_AFTER_MS = 1000;

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

/**
 * Janela do acesso remoto. Comeca pela Tela propria; se a maquina responde que a sessao e Wayland, troca para o RDP do
 * GNOME pelo relay (canal rdp). O parametro "rdp=1" abre direto no RDP.
 */
export function RemoteViewerPage() {
  const params = useParams();
  const [search] = useSearchParams();
  const [rdp, setRdp] = useState(search.get('rdp') === '1');
  const { data: me } = useMe();
  if (rdp) {
    const ticket = search.get('chamado');
    return (
      <RdpViewer
        agentId={Number(params.agentId)}
        viewOnly={search.get('visualizar') === '1'}
        ticketId={ticket ? Number(ticket) : null}
        canFiles={hasPermission(me, PERMISSIONS.agentsFiles)}
      />
    );
  }
  return <DesktopViewer onWayland={() => setRdp(true)} />;
}

function DesktopViewer({ onWayland }: { onWayland: () => void }) {
  const params = useParams();
  const agentId = Number(params.agentId);
  const [search] = useSearchParams();
  const ticket = search.get('chamado');
  const { data: me } = useMe();
  // Com a permissao de arquivos, a mesma sessao traz o canal files (arrastar e soltar, painel e arquivos copiados).
  const canFiles = hasPermission(me, PERMISSIONS.agentsFiles);
  const options = useMemo(
    () => ({
      channels: canFiles ? (['desktop', 'files'] as const).slice() : (['desktop'] as const).slice(),
      viewOnly: search.get('visualizar') === '1',
      ticketId: ticket ? Number(ticket) : null,
    }),
    [search, ticket, canFiles],
  );

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cursorRef = useRef<HTMLDivElement | null>(null);
  // Cursor remoto separado da imagem (contrato, secao 5.1) e estado do ponteiro local.
  const remoteCursor = useRef<{ body: CursorBody; shape: CursorShape | null } | null>(null);
  const local = useRef<{ inside: boolean; lastMove: number; sent: { x: number; y: number } | null; buttons: number }>({
    inside: false,
    lastMove: 0,
    sent: null,
    buttons: 0,
  });
  const view = useRef<{ viewOnly: boolean; display: RemoteDisplay | undefined; separateCursor: boolean }>({
    viewOnly: options.viewOnly,
    display: undefined,
    separateCursor: false,
  });
  const [cursorShapes] = useState(() => new CursorShapes());
  // Movimentos e roda: no maximo um envio a cada 16 ms (o relay limita os quadros por segundo).
  const [moves] = useState(() => new Coalescer<MouseBody>((_, next) => next));
  const [wheels] = useState(() => new Coalescer<WheelBody>((a, b) => ({ dx: a.dx + b.dx, dy: a.dy + b.dy })));
  const pending = useRef<Promise<DecodedTile | null>[]>([]);
  const pressed = useRef(new Set<string>());
  const [hello, setHello] = useState<HelloBody | null>(null);
  const [displays, setDisplays] = useState<RemoteDisplay[]>([]);
  const [activeDisplay, setActiveDisplay] = useState(0);
  const [preset, setPreset] = useState<QualityPreset>('media');
  // Som da maquina: desligado ao abrir (o navegador so libera audio depois de um clique).
  const [sound, setSound] = useState(false);
  const [player] = useState(() => new AudioPlayer());
  const [viewOnly, setViewOnly] = useState(options.viewOnly);
  const [consent, setConsent] = useState<string | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [firstFrame, setFirstFrame] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [copied, setCopied] = useState<FilesCopiedBody | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
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

  // Desenha o cursor remoto sobre a tela quando o ponteiro local nao o representa: somente visualizar, mouse fora da
  // tela ou cursor movido por outra pessoa. Controlando, o ponteiro local ganha a forma do cursor remoto.
  const showCursor = useCallback(() => {
    const el = cursorRef.current;
    const canvas = canvasRef.current;
    const box = containerRef.current;
    if (!el || !canvas || !box) return;
    const rc = remoteCursor.current;
    const { viewOnly: onlyView, display: shownDisplay, separateCursor } = view.current;
    const pointerState = local.current;
    const visible = separateCursor && rc !== null && rc.body.visible;
    canvas.style.cursor = visible && !onlyView ? cssCursor(rc.shape) : 'default';
    let placement = null;
    if (visible && rc.shape && shownDisplay && canvas.width > 0 && canvas.height > 0) {
      const remoteMoved =
        pointerState.sent !== null &&
        performance.now() - pointerState.lastMove > REMOTE_MOVED_AFTER_MS &&
        Math.hypot(
          (rc.body.x * shownDisplay.w) / canvas.width - pointerState.sent.x,
          (rc.body.y * shownDisplay.h) / canvas.height - pointerState.sent.y,
        ) > 12;
      if (onlyView || !pointerState.inside || remoteMoved) {
        const c = canvas.getBoundingClientRect();
        const b = box.getBoundingClientRect();
        placement = placeCursor(
          rc.body,
          rc.shape,
          { width: canvas.width, height: canvas.height },
          { left: c.left - b.left, top: c.top - b.top, width: c.width, height: c.height },
          shownDisplay.w,
        );
      }
    }
    if (!placement || !rc?.shape) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'block';
    el.style.width = `${String(placement.width)}px`;
    el.style.height = `${String(placement.height)}px`;
    el.style.backgroundImage = `url("${rc.shape.url}")`;
    el.style.transform = `translate(${String(placement.left)}px, ${String(placement.top)}px)`;
  }, []);

  const onTile = useCallback((tile: TileFrame) => {
    // O quadro chega num ArrayBuffer proprio: o Blob le direto do trecho do JPEG, sem copia extra.
    pending.current.push(
      createImageBitmap(new Blob([tile.jpeg], { type: 'image/jpeg' }))
        .then((bitmap) => ({ tile, bitmap }))
        .catch(() => null),
    );
  }, []);

  const onFrameEnd = useCallback(
    async (end: FrameEndFrame) => {
      const decoded = await Promise.all(pending.current.splice(0));
      const canvas = canvasRef.current;
      if (canvas && ctxRef.current?.canvas !== canvas) ctxRef.current = canvas.getContext('2d', { alpha: false });
      const ctx = ctxRef.current;
      if (!canvas || !ctx) {
        for (const item of decoded) item?.bitmap.close();
        return;
      }
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
      showCursor();
    },
    [showCursor],
  );

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
    onCursor: (body) => {
      remoteCursor.current = { body, shape: cursorShapes.update(body) };
      showCursor();
    },
    onAudio: (frame) => player.push(frame),
    onFrameEnd,
    onConsent: setConsent,
    onClipboard: (body) => void bridge().fromRemote(body),
    onFilesCopied: setCopied,
    onError: (_code, message) => setAgentError(message),
  });

  const wayland = status.kind === 'failed' && status.code === 'REMOTE_WAYLAND';
  useEffect(() => {
    if (wayland) onWayland();
  }, [wayland, onWayland]);

  const connected = status.kind === 'open' && status.phase === 'connected';
  const sessionId = status.kind === 'open' && status.session.channels.includes('files') ? status.session.sessionId : null;
  const transfers = useTransfers(sessionId);
  const home = useQuery({
    queryKey: ['remote-files', sessionId, 'home'],
    queryFn: () => remoteFilesApi.home(sessionId ?? ''),
    enabled: sessionId !== null && connected,
    retry: 1,
  });

  // Arrastar e soltar na tela: os arquivos vao para a Area de Trabalho do usuario (D-05).
  const onDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDropping(false);
    const files = Array.from(event.dataTransfer.files);
    if (!home.data || files.length === 0) return;
    const sent = await transfers.upload(files, home.data.desktop, home.data.separator);
    if (sent.length > 0) setNotice(`${String(sent.length)} arquivo(s) enviado(s) para a Área de Trabalho.`);
  };

  useEffect(() => {
    outbox.current = (body) => {
      if (!viewOnly) connection.current?.sendJson(FRAME.clipboard, body);
    };
  }, [connection, viewOnly]);

  // Ajustes de imagem: enviados no HELLO e a cada mudanca. Com o cursor separado, o agente nao desenha o ponteiro
  // na imagem e manda o CURSOR (contrato, secao 5.1).
  const separateCursor = hello?.features.includes('cursor') ?? false;
  const hasAudio = hello?.features.includes('audio') ?? false;
  const audio = hasAudio && sound;
  useEffect(() => {
    if (!connected || !hello) return;
    connection.current?.sendJson(FRAME.settings, { ...PRESETS[preset], display: activeDisplay, cursor: separateCursor, audio });
  }, [connected, hello, preset, activeDisplay, connection, separateCursor, audio]);

  useEffect(() => () => player.stop(), [player]);

  const toggleSound = async () => {
    if (sound) {
      setSound(false);
      player.stop();
      return;
    }
    // Dentro do clique: o AudioContext so toca quando nasce de um gesto do tecnico.
    if (await player.start()) setSound(true);
  };

  const display = displays.find((d) => d.id === activeDisplay) ?? displays[0];
  useLayoutEffect(() => {
    view.current = { viewOnly, display, separateCursor };
    showCursor();
  });

  // Tela redimensionada: o cursor desenhado acompanha.
  useEffect(() => {
    const box = containerRef.current;
    if (!box) return;
    const observer = new ResizeObserver(() => showCursor());
    observer.observe(box);
    return () => observer.disconnect();
  }, [showCursor]);

  useEffect(
    () => () => {
      moves.cancel();
      wheels.cancel();
    },
    [moves, wheels],
  );

  const send = (type: number, body: unknown) => {
    if (!viewOnly) connection.current?.sendJson(type, body);
  };

  const pointer = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!display || viewOnly) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const point = toRemotePoint(event.clientX - rect.left, event.clientY - rect.top, rect, display);
    const state = local.current;
    const buttonsChanged = event.buttons !== state.buttons;
    state.lastMove = performance.now();
    state.sent = point;
    state.buttons = event.buttons;
    const body = { ...point, buttons: event.buttons };
    if (event.type === 'pointermove' && !buttonsChanged) {
      moves.push(body, (b) => send(FRAME.mouse, b));
      return;
    }
    // Botao apertado ou solto: o movimento pendente vai antes e o botao sai na hora.
    moves.flush();
    send(FRAME.mouse, body);
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
    moves.flush();
    send(FRAME.key, { code: event.code, down });
  };

  const onPaste = async (event: ClipboardEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    if (viewOnly) return;
    const pastedFiles = Array.from(event.clipboardData.files);
    if (pastedFiles.length > 0 && hello?.os === 'windows' && home.data && sessionId) {
      // Arquivos colados: vao para Downloads e entram na area de transferencia da estacao (Windows).
      window.clearTimeout(paste.current.timer);
      paste.current.waiting = false;
      const sent = await transfers.upload(pastedFiles, home.data.downloads, home.data.separator);
      if (sent.length > 0) {
        await remoteFilesApi.clipboard(sessionId, sent.map((r) => r.transferId)).catch(() => undefined);
        setNotice('Arquivos prontos na máquina remota: aperte Ctrl+V onde quiser colar.');
      }
      return;
    }
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
    moves.flush();
    wheels.push({ dx: wheelUnits(event.deltaX, event.deltaMode), dy: wheelUnits(event.deltaY, event.deltaMode) }, (b) => {
      if (b.dx !== 0 || b.dy !== 0) send(FRAME.wheel, b);
    });
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
          {hasAudio && (
            <Tooltip label={sound ? 'Desligar o som da máquina' : 'Ouvir o som da máquina'}>
              <Button
                size="xs"
                variant={sound ? 'filled' : 'default'}
                leftSection={sound ? <IconVolume size={14} /> : <IconVolumeOff size={14} />}
                onClick={() => void toggleSound()}
                aria-pressed={sound}
                disabled={!connected}
              >
                Som
              </Button>
            </Tooltip>
          )}
          {hello?.features.includes('clipboard-text') && (
            <Tooltip label="Área de transferência sincronizada: copie de um lado e cole do outro (Ctrl+V)">
              <IconClipboardCheck size={18} aria-label="Área de transferência sincronizada" role="img" />
            </Tooltip>
          )}
          {sessionId && (
            <Button size="xs" variant="default" leftSection={<IconFolders size={14} />} onClick={() => setFilesOpen(true)} disabled={!connected}>
              Arquivos
            </Button>
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
      <Box
        ref={containerRef}
        style={{
          flex: 1,
          minHeight: 0,
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          outline: dropping ? '3px dashed var(--mantine-color-blue-5)' : undefined,
          outlineOffset: -6,
        }}
        onDragOver={(e) => {
          if (!home.data) return;
          e.preventDefault();
          setDropping(true);
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(e) => void onDrop(e)}
      >
        <canvas
          ref={canvasRef}
          tabIndex={0}
          aria-label={`Tela de ${hostname}`}
          data-testid="remote-canvas"
          style={{ maxWidth: '100%', maxHeight: '100%', outline: 'none', display: firstFrame ? 'block' : 'none' }}
          onPointerMove={pointer}
          onPointerEnter={() => {
            local.current.inside = true;
            showCursor();
          }}
          onPointerLeave={() => {
            local.current.inside = false;
            showCursor();
          }}
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
        <div
          ref={cursorRef}
          aria-hidden
          data-testid="remote-cursor"
          style={{ position: 'absolute', left: 0, top: 0, display: 'none', pointerEvents: 'none', backgroundSize: '100% 100%', willChange: 'transform' }}
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
        {copied && sessionId && (
          <Alert pos="absolute" top={12} right={12} color="blue" withCloseButton onClose={() => setCopied(null)} title="Arquivos copiados na máquina remota" maw={420}>
            <Text size="sm">
              {copied.paths.length === 1 ? (copied.paths[0] ?? '') : `${String(copied.paths.length)} itens`} ({formatBytes(copied.totalBytes)})
            </Text>
            <Anchor href={remoteFilesApi.downloadUrl(sessionId, copied.paths)} download size="sm">
              Baixar
            </Anchor>
          </Alert>
        )}
        {notice && (
          <Alert pos="absolute" bottom={56} color="teal" withCloseButton onClose={() => setNotice(null)}>
            {notice}
          </Alert>
        )}
        {agentError && (
          <Alert pos="absolute" bottom={12} color="red" withCloseButton onClose={() => setAgentError(null)}>
            {agentError}
          </Alert>
        )}
      </Box>
      <Drawer opened={filesOpen} onClose={() => setFilesOpen(false)} position="right" size="lg" title="Arquivos da máquina remota">
        {sessionId && <FilesPanel sessionId={sessionId} transfers={transfers} />}
      </Drawer>
    </Stack>
  );
}
