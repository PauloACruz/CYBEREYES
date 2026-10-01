import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScriptDto } from '../../api/types';
import { json, makeMe, mockFetch, renderApp } from '../../test/utils';

function makeScript(overrides: Partial<ScriptDto>): ScriptDto {
  return {
    id: 1,
    name: 'Script',
    description: '',
    category: 'Manutenção',
    shell: 'powershell',
    defaultArgs: [],
    envVars: [],
    defaultTimeout: 90,
    runAsUser: false,
    platforms: ['windows'],
    createdBy: 'admin',
    updatedAt: '2026-09-20T10:00:00Z',
    ...overrides,
  };
}

const scripts: ScriptDto[] = [
  makeScript({ id: 1, name: 'Limpar temporários', description: 'Remove arquivos de %TEMP%' }),
  makeScript({ id: 2, name: 'Atualizar pacotes', category: 'Atualizações', shell: 'shell', platforms: ['linux'] }),
  makeScript({ id: 3, name: 'Coletar logs', category: 'Diagnóstico', shell: 'python', platforms: ['windows', 'linux', 'darwin'] }),
];

describe('página de Scripts', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lista os scripts e filtra por plataforma', async () => {
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['scripts.view'] })),
      'GET /api/scripts': () => json(scripts),
    });
    renderApp('/scripts');

    expect(await screen.findByText('Limpar temporários')).toBeInTheDocument();
    expect(screen.getByText('Atualizar pacotes')).toBeInTheDocument();
    expect(screen.getByText('Coletar logs')).toBeInTheDocument();
    expect(screen.getByText('3 de 3 scripts')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Novo script' })).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Plataforma' }));
    await user.click(await screen.findByRole('option', { name: 'Linux', hidden: true }));

    await waitFor(() => expect(screen.queryByText('Limpar temporários')).not.toBeInTheDocument());
    expect(screen.getByText('Atualizar pacotes')).toBeInTheDocument();
    expect(screen.getByText('Coletar logs')).toBeInTheDocument();
    expect(screen.getByText('2 de 3 scripts')).toBeInTheDocument();
  });

  it('mostra o botão de novo script para quem pode gerenciar', async () => {
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['scripts.view', 'scripts.manage'] })),
      'GET /api/scripts': () => json(scripts),
    });
    renderApp('/scripts');

    expect(await screen.findByRole('button', { name: 'Novo script' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Excluir script Coletar logs' })).toBeInTheDocument();
  });
});
