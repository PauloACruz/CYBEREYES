import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InstallerRequest } from '../../api/types';
import { CLIENTS } from '../../test/fixtures';
import { json, makeMe, mockFetch, renderApp } from '../../test/utils';

const LINUX_COMMAND =
  "curl -fsSL 'https://rmm.exemplo.com/api/install/linux.sh' | sudo bash -s -- --client-id 1 --site-id 10 --auth abc123";

describe('modal de instalação do agente', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('gera o comando para Linux com tipo detectado automaticamente', async () => {
    let sent: InstallerRequest | undefined;
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['agents.view', 'agents.install'] })),
      'GET /api/clients': () => json(CLIENTS),
      'GET /api/agents': () => json({ items: [], total: 0, page: 1, pageSize: 50 }),
      'POST /api/agents/installer': (init) => {
        sent = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as InstallerRequest;
        return json({ command: LINUX_COMMAND, expiresAt: '2026-10-02T12:00:00Z', plat: 'linux' });
      },
    });
    renderApp('/agentes');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Instalar agente' }));
    await user.click(await screen.findByRole('radio', { name: 'Linux' }));
    expect(screen.getByRole('combobox', { name: /^Tipo/ })).toHaveValue('Detectar automaticamente');
    await user.click(screen.getByRole('button', { name: 'Gerar comando' }));

    expect(await screen.findByText(LINUX_COMMAND)).toBeInTheDocument();
    expect(sent).toEqual({ siteId: 10, agentType: 'auto', plat: 'linux', goarch: 'amd64', expiresHours: 24 });
    expect(screen.getByText(/estação quando tem interface gráfica e como servidor quando tem só terminal/)).toBeInTheDocument();
    expect(screen.getByText(/Válido até/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copiar comando' })).toBeEnabled());
  });
});
