import { Text } from '@mantine/core';
import { HubTerminal } from '../../components/terminal/HubTerminal';
import { hubErrorDetail } from '../../components/terminal/hubError';

function startErrorMessage(error: unknown): string {
  const detail = hubErrorDetail(error);
  return detail ? `Não foi possível abrir o terminal SSH: ${detail}` : 'Não foi possível abrir o terminal SSH. Tente novamente.';
}

interface SshTerminalProps {
  serverId: number;
  /** Com a aplicacao, o terminal abre na pasta dela. */
  webAppId?: number;
  label: string;
  directory?: string | null;
}

/** Terminal SSH interativo no navegador (xterm-256color), aberto pela API do Cybereyes. */
export function SshTerminal({ serverId, webAppId, label, directory }: SshTerminalProps) {
  return (
    <HubTerminal
      label={label}
      height={520}
      start={(hub, cols, rows) => hub.invoke<string>('StartSshTerminal', serverId, webAppId ?? null, cols, rows)}
      startErrorMessage={startErrorMessage}
      toolbar={() =>
        directory ? (
          <Text size="sm" c="dimmed">
            Abre em <Text span ff="monospace">{directory}</Text>
          </Text>
        ) : null
      }
    />
  );
}
