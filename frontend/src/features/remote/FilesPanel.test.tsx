import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RemoteFileEntry, RemoteSessionDto } from '../../api/types';
import { makeAgentDetail } from '../../test/fixtures';
import { json, makeMe, mockFetch, renderApp } from '../../test/utils';
import { parentPath, pathCrumbs } from './uploads';

const sid = 'f'.repeat(32);
const session: RemoteSessionDto = {
  sessionId: sid, agentId: 1, hostname: 'PC-01', user: 'tecnico', channels: ['files'], viewOnly: false, state: 'starting', consent: 'none',
  startedAt: '2026-10-05T12:00:00Z', endedAt: null, endReason: null, relayUrl: null, viewerToken: null, expiresAt: null, ticketId: null,
  firstFrameAt: null, bytesToViewer: 0, bytesToAgent: 0, clipboardToRemote: 0, clipboardToLocal: 0,
};
const desktop = 'C:\\Users\\maria\\Desktop';
const entries: RemoteFileEntry[] = [
  { name: 'Projetos', path: `${desktop}\\Projetos`, kind: 'dir', size: 0, modifiedAt: '2026-10-01T10:00:00Z', hidden: false },
  { name: 'relatório.pdf', path: `${desktop}\\relatório.pdf`, kind: 'file', size: 2048, modifiedAt: '2026-10-02T10:00:00Z', hidden: false },
  { name: 'desktop.ini', path: `${desktop}\\desktop.ini`, kind: 'file', size: 10, modifiedAt: '2026-10-02T10:00:00Z', hidden: true },
];

describe('arquivos da maquina remota', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lista a Area de Trabalho, navega, cria pasta e apaga com confirmacao', async () => {
    const created: unknown[] = [];
    const deleted: unknown[] = [];
    const listed: string[] = [];
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['agents.view', 'agents.files'] })),
      'GET /api/agents/1': () => json(makeAgentDetail()),
      'POST /api/agents/1/remote/sessions': () => json(session, 201),
      [`DELETE /api/remote/sessions/${sid}`]: () => new Response(null, { status: 204 }),
      [`GET /api/remote/sessions/${sid}/files/home`]: () => json({ desktop, home: 'C:\\Users\\maria', downloads: 'C:\\Users\\maria\\Downloads', separator: '\\' }),
      [`GET /api/remote/sessions/${sid}/files/list`]: (_, url) => {
        listed.push(url.searchParams.get('path') ?? '');
        return json(url.searchParams.get('path') === desktop ? entries : []);
      },
      [`POST /api/remote/sessions/${sid}/files/mkdir`]: (init) => {
        created.push(JSON.parse(init?.body as string));
        return new Response(null, { status: 204 });
      },
      [`POST /api/remote/sessions/${sid}/files/delete`]: (init) => {
        deleted.push(JSON.parse(init?.body as string));
        return new Response(null, { status: 204 });
      },
    });
    renderApp('/agentes/1?aba=arquivos');
    const user = userEvent.setup();

    expect(await screen.findByText('relatório.pdf')).toBeInTheDocument();
    expect(screen.getByText('2 KB')).toBeInTheDocument();
    expect(screen.queryByText('desktop.ini')).toBeNull();
    const download = screen.getByRole('button', { name: 'Ações de relatório.pdf' });
    await user.click(download);
    const link = await screen.findByRole('menuitem', { name: 'Baixar' });
    expect(link.getAttribute('href')).toBe(`/api/remote/sessions/${sid}/download?path=${encodeURIComponent(`${desktop}\\relatório.pdf`)}`);
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Nova pasta' }));
    await user.type(await screen.findByLabelText(/Nome/), 'Entrega');
    await user.click(screen.getByRole('button', { name: 'Criar' }));
    await waitFor(() => expect(created).toEqual([{ path: `${desktop}\\Entrega` }]));
    // O dialogo fecha com transicao e a lista recarrega: o menu so abre direito depois disso (no CI pode demorar).
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await user.click(await screen.findByRole('button', { name: 'Ações de Projetos' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Apagar' }, { timeout: 3000 }));
    const dialog = await screen.findByRole('dialog', { name: 'Apagar' });
    await user.click(within(dialog).getByRole('button', { name: 'Apagar' }));
    await waitFor(() => expect(deleted).toEqual([{ path: `${desktop}\\Projetos`, recursive: true }]));

    await user.click(screen.getByRole('button', { name: 'Projetos' }));
    await waitFor(() => expect(listed).toContain(`${desktop}\\Projetos`));
    expect(await screen.findByText('Pasta vazia. Arraste arquivos para cá para enviar.')).toBeInTheDocument();
  });

  it('monta a navegacao das pastas no Windows e no Unix', () => {
    expect(pathCrumbs('C:\\Users\\maria', '\\')).toEqual([
      { label: 'C:', path: 'C:\\' },
      { label: 'Users', path: 'C:\\Users' },
      { label: 'maria', path: 'C:\\Users\\maria' },
    ]);
    expect(parentPath('C:\\Users', '\\')).toBe('C:\\');
    expect(parentPath('C:\\', '\\')).toBeNull();
    expect(pathCrumbs('/home/maria', '/').map((c) => c.path)).toEqual(['/', '/home', '/home/maria']);
    expect(parentPath('/', '/')).toBeNull();
  });
});
