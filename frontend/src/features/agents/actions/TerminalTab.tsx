import { useState } from 'react';
import { Select } from '@mantine/core';
import { AGENT_TIMEOUT_TITLE } from '../../../api/client';
import type { AgentDetail } from '../../../api/types';
import { HubTerminal } from '../../../components/terminal/HubTerminal';
import { hubErrorDetail } from '../../../components/terminal/hubError';
import { isWindows } from './shells';

const DEFAULT_SHELL = 'padrao';

function shellOptions(plat: string): { value: string; label: string }[] {
  return isWindows(plat)
    ? [
        { value: DEFAULT_SHELL, label: 'Padrão (cmd)' },
        { value: 'powershell', label: 'PowerShell' },
      ]
    : [
        { value: DEFAULT_SHELL, label: 'Padrão (/bin/bash)' },
        { value: '/bin/sh', label: '/bin/sh' },
        { value: '/bin/zsh', label: '/bin/zsh' },
      ];
}

function startErrorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : '';
  if (/AGENT_TIMEOUT|timed? ?out/i.test(text)) return `${AGENT_TIMEOUT_TITLE}. Verifique se ele está online e tente novamente.`;
  const detail = hubErrorDetail(error);
  return detail ? `Não foi possível abrir o terminal: ${detail}` : 'Não foi possível abrir o terminal. Tente novamente.';
}

export function TerminalTab({ agent }: { agent: AgentDetail }) {
  const [shell, setShell] = useState<string>(DEFAULT_SHELL);

  return (
    <HubTerminal
      label={`Terminal de ${agent.hostname}`}
      start={(hub, cols, rows) => hub.invoke<string>('StartTerminal', agent.id, cols, rows, shell === DEFAULT_SHELL ? null : shell)}
      startErrorMessage={startErrorMessage}
      toolbar={(status) => (
        <Select
          aria-label="Shell do terminal"
          data={shellOptions(agent.plat)}
          value={shell}
          onChange={(value) => setShell(value ?? DEFAULT_SHELL)}
          allowDeselect={false}
          disabled={status === 'open' || status === 'starting'}
          w={200}
        />
      )}
    />
  );
}
