import { Alert, Badge, Box, Button, Center, Drawer, Group, Loader, Stack, Text, Tooltip } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { IconFolders, IconKeyboard, IconMaximize, IconPlugConnectedX, IconScreenShare } from '@tabler/icons-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { remoteApi } from '../../api/remote';
import type { RemoteChannel } from '../../api/types';
import { endReasonText, relayUrl } from './connection';
import { FilesPanel } from './FilesPanel';
import { rdpErrorMessage, startRdp, type RdpSession } from './rdpClient';
import { useRemoteSession } from './useRemoteSession';
import { useTransfers } from './useTransfers';

type RdpPhase = 'loading' | 'connected' | 'ended' | 'failed';

const NO_HANDLERS = {
  onHello: () => undefined,
  onDisplays: () => undefined,
  onTile: () => undefined,
  onFrameEnd: () => Promise.resolve(),
  onConsent: () => undefined,
  onClipboard: () => undefined,
  onFilesCopied: () => undefined,
  onError: () => undefined,
};

export interface RdpViewerProps {
  agentId: number;
  viewOnly: boolean;
  ticketId: number | null;
  canFiles: boolean;
}

/**
 * Tela de Linux com sessao Wayland: o EYES liga o RDP do GNOME e leva o RDP pelo relay (canal rdp); o navegador usa o
 * cliente RDP do IronRDP. O aviso e o pedido de acesso seguem a politica; o estado vem da sessao na API.
 */
export function RdpViewer({ agentId, viewOnly, ticketId, canFiles }: RdpViewerProps) {
  const options = useMemo(
    () => {
      const channels: RemoteChannel[] = canFiles ? ['rdp', 'files'] : ['rdp'];
      return { channels, viewOnly, ticketId };
    },
    [canFiles, viewOnly, ticketId],
  );
  const { status } = useRemoteSession(agentId, options, NO_HANDLERS);
  const session = status.kind === 'open' ? status.session : null;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rdpRef = useRef<RdpSession | null>(null);
  const [phase, setPhase] = useState<RdpPhase>('loading');
  const [problem, setProblem] = useState<string | null>(null);
  const [filesOpen, setFilesOpen] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!session?.rdp || !session.viewerToken || !host) return;
    let cancelled = false;
    const target = {
      proxyAddress: relayUrl(session.sessionId, window.location, 'rdp'),
      authToken: session.viewerToken,
      destination: session.rdp.destination,
      username: session.rdp.username,
      password: session.rdp.password,
      clipboard: session.rdp.clipboard,
    };
    startRdp(host, target)
      .then((rdp) => {
        if (cancelled) {
          rdp.close();
          return;
        }
        rdpRef.current = rdp;
        setPhase('connected');
        void rdp.done
          .catch(() => undefined)
          .then(() => {
            if (!cancelled) setPhase('ended');
          });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setProblem(rdpErrorMessage(error));
        setPhase('failed');
      });
    return () => {
      cancelled = true;
      rdpRef.current?.close();
      rdpRef.current = null;
    };
  }, [session]);

  // Estado da sessao (pedido de acesso e motivo do fim), que o cliente RDP nao conhece.
  const watching = session !== null && phase !== 'failed';
  const server = useQuery({
    queryKey: ['remote-session', session?.sessionId],
    queryFn: () => remoteApi.session(session?.sessionId ?? ''),
    enabled: watching,
    refetchInterval: (query) => (query.state.data?.state === 'ended' ? false : 2000),
  });
  const serverEnded = server.data?.state === 'ended';
  const waitingConsent = server.data?.state === 'waiting-consent';

  const sessionId = session?.channels.includes('files') ? session.sessionId : null;
  const transfers = useTransfers(sessionId);
  const hostname = session?.hostname ?? '';

  useEffect(() => {
    document.title = hostname ? `${hostname} - Acesso remoto` : 'Acesso remoto';
  }, [hostname]);

  let label = 'Ativando o RDP do GNOME';
  let color = 'gray';
  let message: string | null = null;
  if (status.kind === 'failed' || status.kind === 'ended') {
    label = 'Falhou';
    color = 'red';
    message = status.message;
  } else if (serverEnded) {
    label = 'Encerrada';
    message = endReasonText(server.data?.endReason);
  } else if (phase === 'failed') {
    label = 'Falhou';
    color = 'red';
    message = problem;
  } else if (phase === 'ended') {
    label = 'Encerrada';
    message = 'Sessão RDP encerrada.';
  } else if (waitingConsent) {
    label = 'Aguardando o usuário aceitar';
    color = 'yellow';
  } else if (phase === 'connected') {
    label = 'Conectado';
    color = 'teal';
  } else if (session) {
    label = 'Conectando';
  }

  const fullscreen = async () => {
    await containerRef.current?.requestFullscreen();
    await (navigator as Navigator & { keyboard?: { lock?: () => Promise<void> } }).keyboard?.lock?.().catch(() => undefined);
  };

  return (
    <Stack gap={0} h="100vh" bg="dark.8">
      <Group justify="space-between" px="sm" py={6} wrap="nowrap" bg="dark.7">
        <Group gap="sm" wrap="nowrap">
          <IconScreenShare size={18} aria-hidden />
          <Text fw={600} size="sm">
            {hostname || 'Acesso remoto'}
          </Text>
          <Badge color={color} variant="light" aria-live="polite">
            {label}
          </Badge>
          <Tooltip label="Sessão Wayland: a tela vem do RDP do GNOME, levado pelo relay do acesso remoto">
            <Badge variant="outline" color="gray">
              RDP do GNOME
            </Badge>
          </Tooltip>
        </Group>
        <Group gap="xs" wrap="nowrap">
          {sessionId && (
            <Button size="xs" variant="default" leftSection={<IconFolders size={14} />} onClick={() => setFilesOpen(true)} disabled={phase !== 'connected'}>
              Arquivos
            </Button>
          )}
          <Button size="xs" variant="default" leftSection={<IconKeyboard size={14} />} onClick={() => rdpRef.current?.ui.ctrlAltDel()} disabled={viewOnly || phase !== 'connected'}>
            Ctrl+Alt+Del
          </Button>
          <Tooltip label="Tela cheia">
            <Button size="xs" variant="default" onClick={() => void fullscreen()} aria-label="Tela cheia">
              <IconMaximize size={14} />
            </Button>
          </Tooltip>
          <Button
            size="xs"
            color="red"
            leftSection={<IconPlugConnectedX size={14} />}
            onClick={() => {
              rdpRef.current?.close();
              window.close();
            }}
          >
            Encerrar
          </Button>
        </Group>
      </Group>
      <Box ref={containerRef} style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <Box ref={hostRef} data-testid="rdp-host" style={{ position: 'absolute', inset: 0, visibility: phase === 'connected' && !serverEnded ? 'visible' : 'hidden' }} />
        {(phase !== 'connected' || serverEnded) && (
          <Center pos="absolute" inset={0}>
            {message ? (
              <Alert color={color === 'red' ? 'red' : 'gray'} title="Acesso remoto" maw={480}>
                {message}
              </Alert>
            ) : (
              <Stack align="center" gap="xs">
                <Loader color="gray" />
                <Text c="dimmed" size="sm">
                  {label}
                </Text>
              </Stack>
            )}
          </Center>
        )}
      </Box>
      <Drawer opened={filesOpen} onClose={() => setFilesOpen(false)} position="right" size="lg" title="Arquivos da máquina remota">
        {sessionId && <FilesPanel sessionId={sessionId} transfers={transfers} />}
      </Drawer>
    </Stack>
  );
}
