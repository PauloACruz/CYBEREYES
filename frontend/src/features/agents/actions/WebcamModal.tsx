import { useEffect, useRef, useState } from 'react';
import { Alert, Badge, Box, Button, Group, Image, Loader, Modal, Stack, Text } from '@mantine/core';
import { IconAlertTriangle, IconCamera, IconVideoOff } from '@tabler/icons-react';
import type { AgentDetail } from '../../../api/types';
import { useConsoleHubConnection } from '../../../realtime/consoleHubContext';

type Status = 'starting' | 'live' | 'closed';

interface WebcamModalProps {
  agent: AgentDetail;
  opened: boolean;
  onClose: () => void;
}

// Renova a sessao no servidor a cada 60s: webcam_start com o mesmo id reinicia o prazo de inatividade.
const PING_INTERVAL_MS = 60_000;

function friendlyError(err: unknown): string {
  const text = err instanceof Error ? err.message : '';
  const detail = text.split('HubException:')[1]?.trim();
  return detail || 'Não foi possível abrir a câmera. Tente novamente.';
}

export function WebcamModal({ agent, opened, onClose }: WebcamModalProps) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={`Webcam de ${agent.hostname}`}
      size="lg"
      centered
      overlayProps={{ blur: 2 }}
    >
      {opened && <WebcamStream agent={agent} onClose={onClose} />}
    </Modal>
  );
}

/** O stream so monta quando o modal abre, entao o estado inicial do React ja e o certo (sem reset num useEffect). */
function WebcamStream({ agent, onClose }: { agent: AgentDetail; onClose: () => void }) {
  const { connection, connected } = useConsoleHubConnection();
  const [status, setStatus] = useState<Status>('starting');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const sessionRef = useRef<string | null>(null);
  const latestRef = useRef<string | null>(null);

  useEffect(() => {
    if (!connection) {
      return;
    }
    const conn = connection;

    const onFrame = (sessionId: string, base64: string) => {
      if (sessionId !== sessionRef.current) return;
      const url = `data:image/jpeg;base64,${base64}`;
      latestRef.current = url;
      setImageUrl(url);
    };
    const onClosed = (sessionId: string, error: string | null) => {
      if (sessionId !== sessionRef.current) return;
      sessionRef.current = null;
      setStatus('closed');
      setMessage(error || 'A transmissão foi encerrada.');
    };
    conn.on('webcamFrame', onFrame);
    conn.on('webcamClosed', onClosed);

    const pingTimer = window.setInterval(() => {
      const id = sessionRef.current;
      if (id) conn.invoke('PingWebcam', id).catch(() => undefined);
    }, PING_INTERVAL_MS);

    let cancelled = false;
    conn
      .invoke<string>('StartWebcam', agent.id)
      .then((sessionId) => {
        if (cancelled) {
          conn.invoke('StopWebcam', sessionId).catch(() => undefined);
          return;
        }
        sessionRef.current = sessionId;
        setStatus('live');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStatus('closed');
        setMessage(friendlyError(err));
      });

    return () => {
      cancelled = true;
      clearInterval(pingTimer);
      conn.off('webcamFrame', onFrame);
      conn.off('webcamClosed', onClosed);
      const id = sessionRef.current;
      sessionRef.current = null;
      if (id) conn.invoke('StopWebcam', id).catch(() => undefined);
    };
  }, [connection, agent.id]);

  const snapshot = () => {
    const url = latestRef.current;
    const id = sessionRef.current;
    if (!url) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const a = document.createElement('a');
    a.href = url;
    a.download = `webcam-${agent.hostname}-${stamp}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (id && connection) connection.invoke('RegisterWebcamSnapshot', id).catch(() => undefined);
  };

  const live = status === 'live' && imageUrl != null;

  return (
    <Stack>
      <Group justify="space-between" wrap="wrap">
        <Badge color={status === 'live' ? 'teal' : status === 'starting' ? 'blue' : 'gray'} variant="light">
          {status === 'live' ? 'Ao vivo' : status === 'starting' ? 'Conectando' : 'Encerrada'}
        </Badge>
        <Group gap="sm">
          <Button leftSection={<IconCamera size={16} />} onClick={snapshot} disabled={!live} variant="light">
            Capturar imagem
          </Button>
          <Button leftSection={<IconVideoOff size={16} />} color="red" variant="light" onClick={onClose}>
            Encerrar
          </Button>
        </Group>
      </Group>
      {!connected && (
        <Text size="sm" c="dimmed">
          Aguardando a conexão em tempo real com o servidor.
        </Text>
      )}
      <Box bg="#1a1b1e" style={{ borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 360 }}>
        {live && imageUrl ? (
          <Image src={imageUrl} alt={`Webcam de ${agent.hostname}`} fit="contain" mah={480} />
        ) : status === 'starting' ? (
          <Group gap="xs" c="dimmed">
            <Loader size="sm" />
            <Text>Abrindo a câmera na máquina...</Text>
          </Group>
        ) : (
          <Text c="dimmed">A transmissão não está ativa.</Text>
        )}
      </Box>
      {status === 'closed' && message && (
        <Alert color="yellow" icon={<IconAlertTriangle size={18} />} title="Transmissão encerrada">
          {message}
        </Alert>
      )}
      <Text size="xs" c="dimmed">
        A câmera da máquina acende o LED enquanto a imagem é transmitida. Toda abertura e cada imagem baixada ficam
        registradas na auditoria.
      </Text>
    </Stack>
  );
}
