import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CreateProjectNoteRequest, ProjectDetail, ProjectProgressRequest, ProjectSummary } from '../../../api/projects';
import { json, makeMe, mockFetch, renderApp } from '../../../test/utils';

const SUMMARY: ProjectSummary = {
  id: 7,
  name: 'Limpeza física',
  status: 'active',
  phase: 'in_progress',
  owner: { id: 'u9', name: 'João Souza' },
  recurrence: 'monthly',
  recurrenceInterval: 1,
  cycle: 2,
  startDate: '2026-11-01',
  dueDate: '2026-11-10',
  clients: [{ id: 1, name: 'Clínica Central' }],
  progress: { agentsTotal: 2, agentsFinished: 1, tasksTotal: 2, tasksFinished: 0, problems: 0, overdueTasks: 0 },
  myOpenTasks: 1,
  updatedAt: '2026-11-02T10:00:00Z',
};

const DETAIL: ProjectDetail = {
  ...SUMMARY,
  description: '',
  nextStartDate: '2026-12-01',
  sites: [],
  agents: [
    {
      id: 1, agentId: 100, hostname: 'PC-RECEPCAO', clientId: 1, clientName: 'Clínica Central', siteId: 10, siteName: 'Recepção', description: null,
      agentStatus: 'online', status: 'pending', note: null, doneByName: null, doneAt: null,
    },
    {
      id: 2, agentId: 101, hostname: 'PC-FINANCEIRO', clientId: 1, clientName: 'Clínica Central', siteId: 11, siteName: 'Financeiro', description: null,
      agentStatus: 'online', status: 'done', note: null, doneByName: 'João Souza', doneAt: '2026-11-02T10:00:00Z',
    },
  ],
  tasks: [
    {
      id: 50, title: 'Avisar o cliente', description: null, assignee: { id: 'u9', name: 'João Souza' }, dueDate: null, position: 0, status: 'pending',
      note: null, doneByName: null, doneAt: null, overdue: false, canUpdate: false,
    },
    {
      id: 51, title: 'Comprar álcool isopropílico', description: null, assignee: { id: 'u1', name: 'Maria Silva' }, dueDate: '2026-11-05', position: 1,
      status: 'pending', note: null, doneByName: null, doneAt: null, overdue: false, canUpdate: true,
    },
  ],
  closedCycles: 1,
  createdByName: 'João Souza',
  createdAt: '2026-10-01T10:00:00Z',
  completedAt: null,
  can: { manage: false, record: true },
};

function body(init: RequestInit | undefined): unknown {
  return JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
}

describe('projetos no app do técnico', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('mostra os projetos do técnico e a aba com as tarefas dele abertas', async () => {
    const urls: string[] = [];
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['projects.view'] })),
      'GET /api/projects': (_init, url) => {
        urls.push(url.search);
        return json([SUMMARY]);
      },
    });
    renderApp('/app/projetos');

    expect(await screen.findByRole('link', { name: 'Projeto Limpeza física' })).toBeInTheDocument();
    expect(screen.getByText('1 tarefa sua')).toBeInTheDocument();
    expect(screen.getByText(/25% feito · todo mês/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Projetos/ })).toBeInTheDocument();
    expect(screen.getByLabelText('1 tarefas suas abertas')).toBeInTheDocument();
    expect(urls.every((q) => q.includes('mine=true'))).toBe(true);
  });

  it('conclui a própria tarefa e registra a estação com observação', async () => {
    let progress: ProjectProgressRequest | undefined;
    let note: CreateProjectNoteRequest | undefined;
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['projects.view'] })),
      'GET /api/projects': () => json([SUMMARY]),
      'GET /api/projects/7': () => json(DETAIL),
      'GET /api/projects/7/notes': () => json([]),
      'PUT /api/projects/7/progress': (init) => {
        progress = body(init) as ProjectProgressRequest;
        return new Response(null, { status: 204 });
      },
      'POST /api/projects/7/notes': (init) => {
        note = body(init) as CreateProjectNoteRequest;
        return json({ id: 900, cycle: 2, kind: 'status', attachments: [], canDelete: true }, 201);
      },
    });
    renderApp('/app/projetos/7');
    const user = userEvent.setup();

    expect(await screen.findByRole('heading', { name: 'Limpeza física' })).toBeInTheDocument();
    // A tarefa do técnico vem primeiro; a de outro responsável não pode ser marcada.
    expect(screen.getByRole('checkbox', { name: 'Concluir Avisar o cliente' })).toBeDisabled();
    expect(screen.getByText(/Você · prazo 05\/11\/2026/)).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Concluir Comprar álcool isopropílico' }));
    await waitFor(() => expect(progress).toEqual({ taskIds: [51], status: 'done' }));

    // Só as estações que faltam, por padrão.
    const stations = screen.getByRole('region', { name: 'Estações (1/2)' });
    expect(within(stations).queryByText('PC-FINANCEIRO')).not.toBeInTheDocument();
    expect(within(stations).getByText('PC-RECEPCAO')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Registrar andamento de PC-RECEPCAO' }));
    const dialog = await screen.findByRole('dialog', { name: 'Registrar andamento: PC-RECEPCAO' });
    await user.click(within(dialog).getByRole('textbox', { name: 'Observação' }));
    await user.paste('Teclado trocado');
    await user.click(within(dialog).getByRole('button', { name: 'Registrar' }));
    await waitFor(() => expect(note).toEqual({ body: 'Teclado trocado', status: 'done', projectAgentId: 1, projectTaskId: null }));
  });
});
