import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PendingActionDto, SoftwareActionResult, SoftwareItem, UninstallSoftwareRequest } from '../../../api/types';
import { makeAgentDetail } from '../../../test/fixtures';
import { json, makeMe, mockFetch, renderApp } from '../../../test/utils';
import { defaultSelection, describeAction, installManager } from './softwareActions';

const me = makeMe({ permissions: ['agents.view', 'software.manage'] });

const firefox: SoftwareItem = {
  name: 'Mozilla Firefox (x64 pt-BR)',
  version: '120.0',
  publisher: 'Mozilla',
  installDate: '2026-01-10',
  size: '230 MB',
  source: 'registry',
  location: 'C:\\Program Files\\Mozilla Firefox',
  uninstall: '"C:\\Program Files\\Mozilla Firefox\\uninstall\\helper.exe"',
  key: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Mozilla Firefox 120.0 (x64 pt-BR)',
};

const result: SoftwareActionResult = {
  ok: true,
  results: 'Desinstalador concluido em 12s (codigo 0).\n3 sobra(s) encontrada(s).',
  leftovers: [
    { kind: 'key', path: 'HKLM\\SOFTWARE\\Mozilla\\Firefox', name: null, detail: null, level: 'high', user: false },
    { kind: 'dir', path: 'C:\\Users\\joao\\AppData\\Roaming\\Mozilla\\Firefox', name: null, detail: '2 KB em 2 arquivo(s)', level: 'medium', user: true },
    { kind: 'value', path: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run', name: 'Updater', detail: null, level: 'high', user: false },
  ],
  scanned: true,
  ranUninstaller: true,
  stillInstalled: false,
  removed: 0,
  failed: 0,
  backup: null,
  reboot: false,
};

function uninstallAction(overrides: Partial<PendingActionDto> = {}): PendingActionDto {
  return {
    id: 41,
    type: 'softwareuninstall',
    details: JSON.stringify({ name: firefox.name, runUninstaller: true }),
    status: 'completed',
    output: JSON.stringify(result),
    createdAt: '2026-10-13T12:00:00Z',
    ...overrides,
  };
}

function bodyOf(init?: RequestInit): unknown {
  return JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
}

describe('desinstalação avançada na aba Software', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('envia a desinstalação com o modo de varredura escolhido', async () => {
    let sent: UninstallSoftwareRequest | undefined;
    mockFetch({
      'GET /api/auth/me': () => json(me),
      'GET /api/agents/1': () => json(makeAgentDetail()),
      'GET /api/agents/1/software': () => json({ updatedAt: '2026-10-13T10:00:00Z', items: [firefox] }),
      'GET /api/agents/1/pending-actions': () => json([]),
      'POST /api/agents/1/software/uninstall': (init) => {
        sent = bodyOf(init) as UninstallSoftwareRequest;
        return json({ pendingActionId: 41 }, 202);
      },
    });
    renderApp('/agentes/1?aba=software');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: `Desinstalar ${firefox.name}` }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: /Avançado/ }));
    await user.click(within(dialog).getByRole('checkbox', { name: /ponto de restauração/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Desinstalar' }));

    await waitFor(() => expect(sent).toBeDefined());
    expect(sent).toEqual({
      name: firefox.name,
      version: '120.0',
      publisher: 'Mozilla',
      location: firefox.location,
      key: firefox.key,
      mode: 'advanced',
      runUninstaller: true,
      restorePoint: true,
    });
  });

  it('revisa as sobras e remove só as marcadas', async () => {
    let sent: unknown;
    mockFetch({
      'GET /api/auth/me': () => json(me),
      'GET /api/agents/1': () => json(makeAgentDetail()),
      'GET /api/agents/1/software': () => json({ updatedAt: null, items: [] }),
      'GET /api/agents/1/pending-actions': () => json([uninstallAction()]),
      'POST /api/agents/1/software/cleanup': (init) => {
        sent = bodyOf(init);
        return json({ pendingActionId: 42 }, 202);
      },
    });
    renderApp('/agentes/1?aba=software');
    const user = userEvent.setup();

    expect(await screen.findByText(`Desinstalar ${firefox.name}`)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Revisar 3 sobra(s)' }));
    const dialog = await screen.findByRole('dialog');
    // Alta confianca fora do perfil vem marcada; dados do usuario nao.
    expect(within(dialog).getByRole('checkbox', { name: 'Remover HKLM\\SOFTWARE\\Mozilla\\Firefox' })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: /AppData/ })).not.toBeChecked();
    await user.click(within(dialog).getByRole('checkbox', { name: /^Remover Updater em / }));
    expect(within(dialog).getByText('1 de 3 selecionado(s)')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Remover selecionados' }));
    await user.click(await screen.findByRole('button', { name: 'Remover' }));

    await waitFor(() => expect(sent).toBeDefined());
    expect(sent).toEqual({ actionId: 41, items: [{ kind: 'key', path: 'HKLM\\SOFTWARE\\Mozilla\\Firefox', name: null }] });
  });

  it('esconde a desinstalação sem a permissão de software', async () => {
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['agents.view'] })),
      'GET /api/agents/1': () => json(makeAgentDetail()),
      'GET /api/agents/1/software': () => json({ updatedAt: null, items: [firefox] }),
      'GET /api/agents/1/pending-actions': () => json([uninstallAction()]),
    });
    renderApp('/agentes/1?aba=software');
    expect(await screen.findByText(firefox.name)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `Desinstalar ${firefox.name}` })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Revisar/ })).not.toBeInTheDocument();
  });
});

describe('ações de software', () => {
  it('descreve cada tipo de ação', () => {
    expect(describeAction(uninstallAction())).toBe(`Desinstalar ${firefox.name}`);
    expect(describeAction(uninstallAction({ details: JSON.stringify({ name: 'App', runUninstaller: false }) }))).toBe('Remoção forçada de App');
    expect(describeAction(uninstallAction({ type: 'softwarecleanup', details: JSON.stringify({ name: 'App', count: 3 }) }))).toBe('Remover 3 sobra(s) de App');
    expect(describeAction(uninstallAction({ type: 'chocoinstall', details: JSON.stringify({ name: 'git' }) }))).toBe('Instalar git');
    expect(installManager(uninstallAction({ type: 'wingetinstall', details: JSON.stringify({ name: 'Git.Git', manager: 'winget' }) }))).toBe('winget');
    expect(installManager(uninstallAction())).toBeNull();
  });

  it('não marca nada quando o programa continua registrado depois do desinstalador', () => {
    expect(defaultSelection({ ...result, stillInstalled: true }).size).toBe(0);
    expect(defaultSelection({ ...result, stillInstalled: true, ranUninstaller: false }).size).toBe(2);
  });
});
