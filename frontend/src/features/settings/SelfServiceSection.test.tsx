import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SelfServiceSettings } from '../../api/types';
import { makeAgent, makeWinCareCatalog } from '../../test/fixtures';
import { json, makeMe, mockFetch, renderApp } from '../../test/utils';

describe('autoatendimento nas configurações', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('mostra as tarefas salvas, carrega o catálogo de um agente online e salva', async () => {
    let saved: SelfServiceSettings | undefined;
    let agentQuery: string | null = null;
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['settings.manage'] })),
      'GET /api/wincare/self-service': () => json({ enabled: false, tasks: ['winget.upgrade_all'] }),
      'GET /api/agents': (_init, url) => {
        agentQuery = url.searchParams.get('status');
        return json({ items: [makeAgent()], total: 1, page: 1, pageSize: 50 });
      },
      'GET /api/agents/1/wincare/catalog': () => json(makeWinCareCatalog()),
      'PUT /api/wincare/self-service': (init) => {
        saved = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as SelfServiceSettings;
        return json(saved);
      },
    });
    renderApp('/configuracoes');

    const section = await screen.findByRole('region', { name: 'Autoatendimento no app do usuário' });
    expect(await within(section).findByRole('checkbox', { name: 'winget.upgrade_all' })).toBeChecked();

    const user = userEvent.setup();
    await user.click(within(section).getByRole('switch', { name: 'Permitir autoatendimento no app do usuário' }));
    await user.click(within(section).getByLabelText(/Agente para carregar o catálogo/));
    await user.click(await screen.findByRole('option', { name: 'PC-RECEPCAO (Clínica Central)', hidden: true }));
    expect(agentQuery).toBe('online');

    await user.click(await within(section).findByRole('checkbox', { name: /Limpar arquivos temporários/ }));
    expect(within(section).queryByText('Reparar imagem (DISM)')).not.toBeInTheDocument();
    await user.click(within(section).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(saved).toEqual({ enabled: true, tasks: ['maintenance.temp', 'winget.upgrade_all'] }));
    expect(await screen.findByText('Configuração de autoatendimento salva.')).toBeInTheDocument();
  });
});
