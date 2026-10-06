import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeAgentDetail } from '../../../test/fixtures';
import { json, makeMe, mockFetch, renderApp } from '../../../test/utils';

const me = makeMe({ permissions: ['agents.view', 'software.manage'] });

describe('instalação de software pelo console', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('pesquisa no Chocolatey e no winget e instala o pacote escolhido', async () => {
    const searched: string[] = [];
    const installs: unknown[] = [];
    mockFetch({
      'GET /api/auth/me': () => json(me),
      'GET /api/agents/1': () => json(makeAgentDetail({ plat: 'windows', hostname: 'PC-01' })),
      'GET /api/agents/1/software': () => json({ updatedAt: null, items: [] }),
      'GET /api/agents/1/pending-actions': () => json([]),
      'GET /api/software/catalog/choco': (_init, url) => {
        searched.push(`choco ${url.searchParams.get('q') ?? ''}`);
        return json({ source: 'choco', items: [{ id: 'GoogleChrome', name: 'Google Chrome', version: '155.0', summary: 'Navegador', downloads: 393971326 }] });
      },
      'GET /api/software/catalog/winget': (_init, url) => {
        searched.push(`winget ${url.searchParams.get('q') ?? ''}`);
        return json({ source: 'winget', items: [{ id: 'Notepad++.Notepad++', name: 'Notepad++', version: '8.9.1', summary: 'Apelido: notepad++', downloads: null }] });
      },
      'POST /api/agents/1/software/install': (init) => {
        installs.push(JSON.parse(typeof init?.body === 'string' ? init.body : '{}'));
        return json({ pendingActionId: 5 }, 202);
      },
    });
    renderApp('/agentes/1?aba=software');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Pesquisar no Chocolatey'), 'chrome');
    expect(await screen.findByText('Google Chrome')).toBeInTheDocument();
    expect(screen.getByText(/^\d.* mi downloads$/)).toBeInTheDocument();
    expect(searched).toEqual(['choco chrome']);
    await user.click(screen.getByRole('button', { name: 'Instalar Google Chrome' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Instalar' }));
    await waitFor(() => expect(installs).toEqual([{ package: 'GoogleChrome', manager: 'choco' }]));

    await user.click(screen.getByRole('radio', { name: 'winget' }));
    const box = screen.getByLabelText('Pesquisar no winget');
    await user.clear(box);
    await user.type(box, 'notepad++');
    await waitFor(() => expect(searched).toContain('winget notepad++'));
    expect(await screen.findByText('Notepad++.Notepad++')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Instalar Notepad++' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Instalar' }));
    await waitFor(() => expect(installs).toContainEqual({ package: 'Notepad++.Notepad++', manager: 'winget' }));
  });

  it('oferece instalar pelo identificador exato quando a pesquisa não o traz', async () => {
    const installs: unknown[] = [];
    mockFetch({
      'GET /api/auth/me': () => json(me),
      'GET /api/agents/1': () => json(makeAgentDetail({ plat: 'windows' })),
      'GET /api/agents/1/software': () => json({ updatedAt: null, items: [] }),
      'GET /api/agents/1/pending-actions': () => json([]),
      'GET /api/software/catalog/choco': () => json({ source: 'choco', items: [] }),
      'POST /api/agents/1/software/install': (init) => {
        installs.push(JSON.parse(typeof init?.body === 'string' ? init.body : '{}'));
        return json({ pendingActionId: 6 }, 202);
      },
    });
    renderApp('/agentes/1?aba=software');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Pesquisar no Chocolatey'), 'pacote-interno');
    expect(await screen.findByText('Nenhum pacote encontrado.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Instalar pacote-interno pelo Chocolatey' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Instalar' }));
    await waitFor(() => expect(installs).toEqual([{ package: 'pacote-interno', manager: 'choco' }]));
  });
});
