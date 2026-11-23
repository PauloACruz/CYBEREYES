import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CreateProjectNoteRequest,
  ProjectAgent,
  ProjectDetail,
  ProjectOptions,
  ProjectProgressRequest,
  ProjectSummary,
  SaveProjectRequest,
} from '../../api/projects';
import { json, makeMe, mockFetch, renderApp } from '../../test/utils';
import { recurrenceLabel } from './projectFormat';

const OPTIONS: ProjectOptions = {
  users: [
    { id: 'u1', name: 'Maria Silva' },
    { id: 'u2', name: 'João Souza' },
  ],
  clients: [{ id: 1, name: 'Clínica Central', sites: [{ id: 10, name: 'Recepção' }, { id: 11, name: 'Financeiro' }] }],
  agents: [
    { id: 100, hostname: 'PC-RECEPCAO', clientId: 1, siteId: 10, description: 'Balcão', status: 'online' },
    { id: 101, hostname: 'PC-FINANCEIRO', clientId: 1, siteId: 11, description: null, status: 'offline' },
  ],
};

const PROGRESS = { agentsTotal: 2, agentsFinished: 1, tasksTotal: 1, tasksFinished: 0, problems: 0, overdueTasks: 1 };

function summary(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: 7,
    name: 'Limpeza física',
    status: 'active',
    phase: 'in_progress',
    owner: { id: 'u1', name: 'Maria Silva' },
    recurrence: 'monthly',
    recurrenceInterval: 1,
    cycle: 3,
    startDate: '2026-11-01',
    dueDate: '2026-11-10',
    clients: [{ id: 1, name: 'Clínica Central' }],
    progress: PROGRESS,
    myOpenTasks: 1,
    updatedAt: '2026-11-02T10:00:00Z',
    ...overrides,
  };
}

function station(overrides: Partial<ProjectAgent> = {}): ProjectAgent {
  return {
    id: 1,
    agentId: 100,
    hostname: 'PC-RECEPCAO',
    clientId: 1,
    clientName: 'Clínica Central',
    siteId: 10,
    siteName: 'Recepção',
    description: 'Balcão',
    agentStatus: 'online',
    status: 'pending',
    note: null,
    doneByName: null,
    doneAt: null,
    ...overrides,
  };
}

function detail(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id: 7,
    name: 'Limpeza física',
    description: 'Limpeza das estações da clínica',
    status: 'active',
    phase: 'in_progress',
    owner: { id: 'u1', name: 'Maria Silva' },
    recurrence: 'monthly',
    recurrenceInterval: 1,
    cycle: 3,
    startDate: '2026-11-01',
    dueDate: '2026-11-10',
    nextStartDate: '2026-12-01',
    clients: [{ id: 1, name: 'Clínica Central' }],
    sites: [],
    agents: [
      station(),
      station({ id: 2, agentId: 101, hostname: 'PC-FINANCEIRO', siteId: 11, siteName: 'Financeiro', status: 'done', doneByName: 'João Souza', doneAt: '2026-11-02T10:00:00Z' }),
    ],
    tasks: [
      {
        id: 50,
        title: 'Comprar álcool isopropílico',
        description: null,
        assignee: { id: 'u2', name: 'João Souza' },
        dueDate: '2026-11-01',
        position: 0,
        status: 'pending',
        note: null,
        doneByName: null,
        doneAt: null,
        overdue: true,
        canUpdate: true,
      },
    ],
    progress: PROGRESS,
    closedCycles: 2,
    createdByName: 'Maria Silva',
    createdAt: '2026-09-01T10:00:00Z',
    updatedAt: '2026-11-02T10:00:00Z',
    completedAt: null,
    can: { manage: true, record: true },
    ...overrides,
  };
}

function body(init: RequestInit | undefined): unknown {
  return JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
}

describe('projetos', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('descreve a repetição', () => {
    expect(recurrenceLabel('none', 1)).toBe('Não se repete');
    expect(recurrenceLabel('monthly', 1)).toBe('Todo mês');
    expect(recurrenceLabel('weekly', 1)).toBe('Toda semana');
    expect(recurrenceLabel('monthly', 6)).toBe('A cada 6 meses');
  });

  it('lista os projetos com progresso e filtra os atrasados pelos indicadores', async () => {
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['projects.view'] })),
      'GET /api/projects': () =>
        json([summary(), summary({ id: 8, name: 'Migração do servidor de arquivos', phase: 'late', clients: [], recurrence: 'none', cycle: 1, myOpenTasks: 0 })]),
      'GET /api/projects/options': () => json(OPTIONS),
    });
    renderApp('/projetos');
    const user = userEvent.setup();

    expect(await screen.findByRole('link', { name: 'Limpeza física' })).toBeInTheDocument();
    expect(screen.getByText('Todo mês · ciclo 3')).toBeInTheDocument();
    expect(screen.getByText('Interno')).toBeInTheDocument();
    expect(screen.getByText('1 minha')).toBeInTheDocument();
    expect(screen.getAllByText(/33% · 1\/2 estações · 0\/1 tarefas/)).toHaveLength(2);
    // Sem projects.manage, nada de criar.
    expect(screen.queryByRole('button', { name: 'Novo projeto' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Atrasados/ }));
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Limpeza física' })).not.toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Migração do servidor de arquivos' })).toBeInTheDocument();
  });

  it('cria um projeto escolhendo o setor, as estações e uma tarefa com responsável', async () => {
    let saved: SaveProjectRequest | undefined;
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['projects.view', 'projects.manage'] })),
      'GET /api/projects': () => json([]),
      'GET /api/projects/options': () => json(OPTIONS),
      'POST /api/projects': (init) => {
        saved = body(init) as SaveProjectRequest;
        return json(detail({ id: 9, name: saved.name, recurrence: 'none', closedCycles: 0 }), 201);
      },
      'GET /api/projects/9': () => json(detail({ id: 9, name: 'Troca de nobreaks', recurrence: 'none', closedCycles: 0 })),
      'GET /api/projects/9/notes': () => json([]),
    });
    renderApp('/projetos');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Novo projeto' }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo projeto' });
    await user.click(within(dialog).getByRole('textbox', { name: 'Nome' }));
    await user.paste('Troca de nobreaks');
    await user.click(within(dialog).getByRole('combobox', { name: 'Setores' }));
    await user.click(await screen.findByRole('option', { name: 'Recepção (Clínica Central)', hidden: true }));
    // Com o setor escolhido, só as estações dele aparecem.
    await waitFor(() => expect(within(dialog).queryByText('PC-FINANCEIRO')).not.toBeInTheDocument());
    await user.click(within(dialog).getByRole('button', { name: 'Marcar as listadas (1)' }));
    await user.click(within(dialog).getByRole('button', { name: 'Adicionar tarefa' }));
    await user.click(within(dialog).getByRole('textbox', { name: 'Tarefa 1' }));
    await user.paste('Desligar os equipamentos');

    await user.click(within(dialog).getByRole('button', { name: 'Criar projeto' }));
    await waitFor(() => expect(saved).toBeDefined());
    expect(saved).toMatchObject({
      name: 'Troca de nobreaks',
      recurrence: 'none',
      clientIds: [],
      siteIds: [10],
      agentIds: [100],
      tasks: [{ title: 'Desligar os equipamentos', assigneeId: null, dueDate: null }],
    });
    expect(await screen.findByRole('heading', { name: 'Troca de nobreaks' })).toBeInTheDocument();
  });

  it('registra o andamento de uma estação e marca várias de uma vez', async () => {
    let note: CreateProjectNoteRequest | undefined;
    let bulk: ProjectProgressRequest | undefined;
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['projects.view', 'agents.view'] })),
      'GET /api/projects/7': () => json(detail()),
      'POST /api/projects/7/notes': (init) => {
        note = body(init) as CreateProjectNoteRequest;
        return json({ id: 900, cycle: 3, kind: 'status', attachments: [], canDelete: true }, 201);
      },
      'PUT /api/projects/7/progress': (init) => {
        bulk = body(init) as ProjectProgressRequest;
        return new Response(null, { status: 204 });
      },
    });
    renderApp('/projetos/7');
    const user = userEvent.setup();

    expect(await screen.findByRole('heading', { name: 'Limpeza física' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Estações \(1\/2\)/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Ciclos concluídos \(2\)/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'PC-RECEPCAO' })).toHaveAttribute('href', '/agentes/100');

    const row = screen.getByRole('link', { name: 'PC-RECEPCAO' }).closest('tr');
    if (!row) throw new Error('linha da estação');
    await user.click(within(row).getByRole('button', { name: 'Registrar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Registrar andamento: PC-RECEPCAO' });
    await user.click(within(dialog).getByRole('textbox', { name: 'Observação' }));
    await user.paste('Gabinete aspirado');
    await user.click(within(dialog).getByRole('button', { name: 'Registrar' }));
    await waitFor(() => expect(note).toEqual({ body: 'Gabinete aspirado', status: 'done', projectAgentId: 1, projectTaskId: null }));

    await user.click(screen.getByRole('checkbox', { name: 'Escolher as estações listadas' }));
    await user.click(screen.getByRole('button', { name: 'Registrar 2 escolhidas' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Marcar como “Não se aplica”…' }));
    const bulkDialog = await screen.findByRole('dialog', { name: 'Registrar andamento: 2 estações' });
    await user.click(within(bulkDialog).getByRole('button', { name: 'Registrar' }));
    await waitFor(() => expect(bulk).toEqual({ agentRowIds: [1, 2], status: 'skipped', note: null }));
  });
});
