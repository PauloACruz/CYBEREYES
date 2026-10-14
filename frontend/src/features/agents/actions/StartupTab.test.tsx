import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StartupChangeRequest, StartupItemDto, StartupListDto } from '../../../api/types';
import { makeAgentDetail } from '../../../test/fixtures';
import { json, makeMe, mockFetch, renderApp } from '../../../test/utils';

const SID = 'S-1-5-21-1004336348-1177238915-682003330-1001';

const discord: StartupItemDto = {
  scope: SID,
  location: 'Run',
  name: 'Discord',
  user: 'EMPRESA\\maria',
  command: '"C:\\Users\\maria\\AppData\\Local\\Discord\\Update.exe" --processStart Discord.exe',
  file: 'C:\\Users\\maria\\AppData\\Local\\Discord\\Update.exe',
  description: 'Discord',
  publisher: 'Discord Inc.',
  enabled: true,
  disabledAt: null,
};

const updater: StartupItemDto = {
  scope: 'HKLM',
  location: 'Run32',
  name: 'AdobeAAMUpdater',
  user: null,
  command: 'C:\\Program Files (x86)\\Adobe\\updater.exe',
  file: 'C:\\Program Files (x86)\\Adobe\\updater.exe',
  description: 'Adobe Updater Startup Utility',
  publisher: 'Adobe Systems Incorporated',
  enabled: false,
  disabledAt: '2026-10-10T12:00:00Z',
};

const list = (items: StartupItemDto[]): StartupListDto => ({ items, users: ['EMPRESA\\maria'] });
const windowsAgent = () => makeAgentDetail({ plat: 'windows', operatingSystem: 'Windows 11 Pro' });

describe('programas da inicialização do Windows', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lista máquina e usuário e desabilita com confirmação, como o Gerenciador de Tarefas', async () => {
    let sent: StartupChangeRequest | undefined;
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['agents.view', 'agents.control'] })),
      'GET /api/agents/1': () => json(windowsAgent()),
      'GET /api/agents/1/startup': () => json(list([discord, updater])),
      'PUT /api/agents/1/startup': (init) => {
        sent = JSON.parse(init?.body as string) as StartupChangeRequest;
        return json(list([{ ...discord, enabled: false, disabledAt: '2026-10-14T18:00:00Z' }, updater]));
      },
    });
    renderApp('/agentes/1?aba=inicializacao');
    const user = userEvent.setup();

    const discordSwitch = await screen.findByRole('switch', { name: 'Discord: habilitado na inicialização' });
    expect(screen.getByText('Adobe Updater Startup Utility')).toBeInTheDocument();
    expect(screen.getByText('Todos os usuários')).toBeInTheDocument();
    expect(screen.getByText('Registro 32 bits (Run)')).toBeInTheDocument();
    expect(screen.getByText(/os usuários com sessão aberta: EMPRESA\\maria/)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Adobe Updater Startup Utility: desabilitado na inicialização' })).not.toBeChecked();

    await user.click(discordSwitch);
    const dialog = await screen.findByRole('dialog', { name: 'Desabilitar na inicialização' });
    expect(within(dialog).getByText(/Discord deixa de abrir quando EMPRESA\\maria entrar no Windows/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Desabilitar' }));

    await waitFor(() => expect(sent).toEqual({ scope: SID, location: 'Run', name: 'Discord', enabled: false }));
    expect(await screen.findByRole('switch', { name: 'Discord: desabilitado na inicialização' })).not.toBeChecked();
    expect(screen.getByText('Discord não vai mais abrir na inicialização do Windows.')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /Desabilitados/ }));
    expect(screen.getAllByRole('switch')).toHaveLength(2);
    await user.type(screen.getByRole('textbox', { name: 'Buscar programas da inicialização' }), 'adobe');
    expect(screen.getAllByRole('switch')).toHaveLength(1);
  });

  it('habilita de novo sem pedir confirmação', async () => {
    let sent: StartupChangeRequest | undefined;
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['agents.view', 'agents.control'] })),
      'GET /api/agents/1': () => json(windowsAgent()),
      'GET /api/agents/1/startup': () => json(list([updater])),
      'PUT /api/agents/1/startup': (init) => {
        sent = JSON.parse(init?.body as string) as StartupChangeRequest;
        return json(list([{ ...updater, enabled: true, disabledAt: null }]));
      },
    });
    renderApp('/agentes/1?aba=inicializacao');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('switch', { name: /Adobe Updater Startup Utility: desabilitado/ }));
    await waitFor(() => expect(sent).toEqual({ scope: 'HKLM', location: 'Run32', name: 'AdobeAAMUpdater', enabled: true }));
    expect(await screen.findByRole('switch', { name: /Adobe Updater Startup Utility: habilitado/ })).toBeChecked();
  });

  it('sem permissão de controle, só mostra o estado', async () => {
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['agents.view'] })),
      'GET /api/agents/1': () => json(windowsAgent()),
      'GET /api/agents/1/startup': () => json(list([discord, updater])),
    });
    renderApp('/agentes/1?aba=inicializacao');

    expect(await screen.findByText('Discord Inc.')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.getByText('Habilitado')).toBeInTheDocument();
    expect(screen.getByText('Desabilitado')).toBeInTheDocument();
  });

  it('o menu Ações leva à aba, e agentes que não são Windows não têm a aba', async () => {
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['agents.view', 'agents.control'] })),
      'GET /api/agents/1': () => json(windowsAgent()),
      'GET /api/agents/2': () => json(makeAgentDetail({ id: 2, plat: 'linux', hostname: 'srv-linux' })),
      'GET /api/agents/1/startup': () => json(list([discord])),
      'GET /api/url-actions': () => json([]),
    });
    const { router } = renderApp('/agentes/1');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Ações' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Programas da inicialização' }));
    await waitFor(() => expect(router.state.location.search).toBe('?aba=inicializacao'));
    expect(await screen.findByRole('switch', { name: 'Discord: habilitado na inicialização' })).toBeInTheDocument();

    await router.navigate('/agentes/2');
    expect((await screen.findAllByText('srv-linux')).length).toBeGreaterThan(0);
    expect(screen.getByRole('tab', { name: /Resumo/ })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Inicialização/ })).not.toBeInTheDocument();
  });
});
