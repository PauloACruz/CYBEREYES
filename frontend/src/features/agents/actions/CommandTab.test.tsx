import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommandRequest } from '../../../api/types';
import { makeAgentDetail } from '../../../test/fixtures';
import { json, makeMe, mockFetch, problem, renderApp } from '../../../test/utils';

const me = makeMe({ permissions: ['agents.view', 'agents.run'] });

async function runCommand(text: string) {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('radio', { name: 'PowerShell' }));
  await user.type(screen.getByRole('textbox', { name: /^Comando/ }), text);
  await user.click(screen.getByRole('button', { name: 'Executar' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(/PC-RECEPCAO com powershell/)).toBeInTheDocument();
  await user.click(within(dialog).getByRole('button', { name: 'Executar' }));
}

describe('aba Comando do agente', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('envia shell, comando e tempo limite e exibe a saída', async () => {
    let sent: CommandRequest | undefined;
    mockFetch({
      'GET /api/auth/me': () => json(me),
      'GET /api/agents/1': () => json(makeAgentDetail()),
      'POST /api/agents/1/command': (init) => {
        sent = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as CommandRequest;
        return json({ historyId: 7, output: 'Windows IP Configuration\n  Host Name: PC-RECEPCAO' });
      },
    });
    renderApp('/agentes/1?aba=comando');

    await runCommand('ipconfig /all');

    expect(await screen.findByText(/Windows IP Configuration/)).toBeInTheDocument();
    expect(sent).toEqual({ shell: 'powershell', command: 'ipconfig /all', timeout: 30, runAsUser: false });
  });

  it('mostra mensagem amigável quando o agente não responde a tempo (504)', async () => {
    mockFetch({
      'GET /api/auth/me': () => json(me),
      'GET /api/agents/1': () => json(makeAgentDetail()),
      'POST /api/agents/1/command': () => problem(504, 'AGENT_TIMEOUT', 'Gateway Timeout'),
    });
    renderApp('/agentes/1?aba=comando');

    await runCommand('hostname');

    expect(await screen.findByText('O agente não respondeu a tempo')).toBeInTheDocument();
    expect(screen.getByText('Verifique se ele está online e tente novamente.')).toBeInTheDocument();
    expect(screen.queryByText('Gateway Timeout')).not.toBeInTheDocument();
  });

  it('não mostra a aba Comando sem a permissão agents.run', async () => {
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['agents.view'] })),
      'GET /api/agents/1': () => json(makeAgentDetail()),
    });
    renderApp('/agentes/1');

    expect(await screen.findByRole('tab', { name: 'Processos' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Comando' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Terminal' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Registro' })).toBeInTheDocument();
  });
});
