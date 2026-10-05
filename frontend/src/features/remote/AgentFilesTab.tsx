import { Alert, Center, Loader, Stack, Text } from '@mantine/core';
import { useMemo } from 'react';
import { FilesPanel } from './FilesPanel';
import { useRemoteSession } from './useRemoteSession';
import { useTransfers } from './useTransfers';

const noop = () => undefined;
const handlers = {
  onHello: noop,
  onDisplays: noop,
  onTile: noop,
  onFrameEnd: () => Promise.resolve(),
  onConsent: noop,
  onClipboard: noop,
  onFilesCopied: noop,
  onError: noop,
};

/** Aba "Arquivos" do agente: abre uma sessao so com o canal files enquanto a aba estiver aberta. */
export function AgentFilesTab({ agentId }: { agentId: number }) {
  const options = useMemo(() => ({ channels: ['files' as const], viewOnly: false, ticketId: null }), []);
  const { status } = useRemoteSession(agentId, options, handlers);
  const sessionId = status.kind === 'open' ? status.session.sessionId : null;
  const transfers = useTransfers(sessionId);

  if (status.kind === 'creating') {
    return (
      <Center py="xl">
        <Stack align="center" gap="xs">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">
            Conectando aos arquivos da máquina
          </Text>
        </Stack>
      </Center>
    );
  }
  if (status.kind === 'failed' || status.kind === 'ended') {
    return (
      <Alert color={status.kind === 'failed' ? 'red' : 'gray'} title="Arquivos">
        {status.message}
      </Alert>
    );
  }
  return sessionId && <FilesPanel sessionId={sessionId} transfers={transfers} />;
}
