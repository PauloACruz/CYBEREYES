import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeAgentDetail } from '../../../test/fixtures';
import { json, makeMe, mockFetch, problem, renderApp } from '../../../test/utils';

const me = makeMe({ permissions: ['agents.view', 'agents.remote'] });

function stubWindowOpen() {
  const popup = { opener: {} as unknown, location: { href: 'about:blank' }, close: vi.fn() };
  const open = vi.fn(() => popup as unknown as Window);
  vi.stubGlobal('open', open);
  return { open, popup };
}

async function openRemote(option: string) {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Acesso remoto' }));
  await user.click(await screen.findByRole('menuitem', { name: option }));
}

describe('acesso remoto do agente', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('pede o link ao servidor e abre a aba escolhida em nova janela', async () => {
    const remote = vi.fn(() =>
      json({
        hostname: 'PC-RECEPCAO',
        control: 'https://mesh.example.com/?login=t&viewmode=11',
        terminal: 'https://mesh.example.com/?login=t&viewmode=12',
        files: 'https://mesh.example.com/?login=t&viewmode=13',
      }),
    );
    mockFetch({
      'GET /api/auth/me': () => json(me),
      'GET /api/agents/1': () => json(makeAgentDetail()),
      'GET /api/agents/1/remote': remote,
    });
    const { open, popup } = stubWindowOpen();
    renderApp('/agentes/1');

    await openRemote('Terminal');

    await vi.waitFor(() => expect(popup.location.href).toBe('https://mesh.example.com/?login=t&viewmode=12'));
    expect(open).toHaveBeenCalledWith('about:blank', '_blank');
    expect(popup.opener).toBeNull();
    expect(remote).toHaveBeenCalledTimes(1);
  });

  it('fecha a janela e explica quando o MeshCentral não está configurado (503)', async () => {
    mockFetch({
      'GET /api/auth/me': () => json(me),
      'GET /api/agents/1': () => json(makeAgentDetail()),
      'GET /api/agents/1/remote': () => problem(503, 'MESH_DISABLED', 'MeshCentral nao configurado'),
    });
    const { popup } = stubWindowOpen();
    renderApp('/agentes/1');

    await openRemote('Tela');

    expect(await screen.findByText('O acesso remoto não está configurado no servidor.')).toBeInTheDocument();
    expect(popup.close).toHaveBeenCalled();
  });

  it('em Linux ativa o RDP, abre o Web-RDP e mostra a credencial', async () => {
    const rdp = vi.fn(() =>
      json({ url: 'https://mesh.example.com/mstsc.html?ws=abc', username: 'eyes', password: 'Senha123abc', port: 3389, sessionUser: 'maria' }),
    );
    mockFetch({
      'GET /api/auth/me': () => json(me),
      'GET /api/agents/1': () => json(makeAgentDetail({ plat: 'linux' })),
      'POST /api/agents/1/remote/rdp': rdp,
    });
    const { popup } = stubWindowOpen();
    renderApp('/agentes/1');

    await openRemote('Tela via RDP (Wayland)');

    expect(await screen.findByDisplayValue('Senha123abc')).toBeInTheDocument();
    expect(screen.getByDisplayValue('eyes')).toBeInTheDocument();
    expect(popup.location.href).toBe('https://mesh.example.com/mstsc.html?ws=abc');
    expect(rdp).toHaveBeenCalledTimes(1);
  });

  it('não oferece RDP em agentes Windows', async () => {
    mockFetch({
      'GET /api/auth/me': () => json(me),
      'GET /api/agents/1': () => json(makeAgentDetail({ plat: 'windows' })),
    });
    renderApp('/agentes/1');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Acesso remoto' }));

    expect(await screen.findByRole('menuitem', { name: 'Tela' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Tela via RDP (Wayland)' })).not.toBeInTheDocument();
  });

  it('não mostra o botão sem a permissão agents.remote', async () => {
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['agents.view'] })),
      'GET /api/agents/1': () => json(makeAgentDetail()),
    });
    renderApp('/agentes/1');

    expect(await screen.findByRole('button', { name: 'Ações' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Acesso remoto' })).not.toBeInTheDocument();
  });
});
