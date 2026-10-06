import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeAgentDetail } from '../../../test/fixtures';
import { json, makeMe, mockFetch, renderApp } from '../../../test/utils';

const me = makeMe({ permissions: ['agents.view', 'agents.remote'] });

async function choose(item: string, permissions: string[] = me.permissions) {
  mockFetch({
    'GET /api/auth/me': () => json(makeMe({ permissions })),
    'GET /api/agents/1': () => json(makeAgentDetail()),
  });
  const open = vi.fn(() => ({ focus: vi.fn() }) as unknown as Window);
  vi.stubGlobal('open', open);
  renderApp('/agentes/1');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Acesso remoto' }));
  await user.click(await screen.findByRole('menuitem', { name: item }));
  return open;
}

describe('acesso remoto do agente', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('abre o visualizador do console em janela propria', async () => {
    const open = await choose('Tela');
    expect(open).toHaveBeenCalledWith('/acesso-remoto/1', 'cybereyes-remoto-1', 'popup,width=1366,height=820');
  });

  it('abre somente para visualizar', async () => {
    const open = await choose('Somente visualizar');
    expect(open).toHaveBeenCalledWith('/acesso-remoto/1?visualizar=1', 'cybereyes-remoto-1', 'popup,width=1366,height=820');
  });

  it('leva ao terminal e aos arquivos do EYES conforme as permissoes', async () => {
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['agents.view', 'agents.remote', 'agents.run', 'agents.files'] })),
      'GET /api/agents/1': () => json(makeAgentDetail()),
    });
    renderApp('/agentes/1');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Acesso remoto' }));
    expect((await screen.findByRole('menuitem', { name: 'Terminal' })).getAttribute('href')).toBe('/agentes/1?aba=terminal');
    expect((await screen.findByRole('menuitem', { name: 'Arquivos', hidden: true })).getAttribute('href')).toBe('/agentes/1?aba=arquivos');
  });
});
