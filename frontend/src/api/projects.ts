import { api } from './client';

// Projetos (docs/api/projetos.md)

export type ProjectStatus = 'active' | 'paused' | 'done' | 'cancelled';
/** Fase exibida: a situação, ou, no projeto ativo, agendado/atrasado/em andamento pelas datas do ciclo. */
export type ProjectPhase = 'scheduled' | 'in_progress' | 'late' | 'paused' | 'done' | 'cancelled';
export type ProjectRecurrence = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
export type ProjectItemStatus = 'pending' | 'in_progress' | 'done' | 'problem' | 'skipped';
export type ProjectNoteKind = 'note' | 'status' | 'event';
export type ProjectListStatus = 'open' | 'all' | ProjectStatus;

export interface ProjectRef {
  id: number;
  name: string;
}

export interface ProjectUserRef {
  id: string;
  name: string;
}

export interface ProjectProgress {
  agentsTotal: number;
  agentsFinished: number;
  tasksTotal: number;
  tasksFinished: number;
  problems: number;
  overdueTasks: number;
}

export interface ProjectSummary {
  id: number;
  name: string;
  status: ProjectStatus;
  phase: ProjectPhase;
  owner: ProjectUserRef | null;
  recurrence: ProjectRecurrence;
  recurrenceInterval: number;
  cycle: number;
  startDate: string | null;
  dueDate: string | null;
  clients: ProjectRef[];
  progress: ProjectProgress;
  myOpenTasks: number;
  updatedAt: string;
}

export interface ProjectSite {
  id: number;
  name: string;
  clientId: number;
  clientName: string;
}

export interface ProjectAgent {
  id: number;
  agentId: number | null;
  hostname: string;
  clientId: number;
  clientName: string | null;
  siteId: number | null;
  siteName: string | null;
  description: string | null;
  /** online, offline ou overdue; nulo quando o agente foi removido. */
  agentStatus: string | null;
  status: ProjectItemStatus;
  note: string | null;
  doneByName: string | null;
  doneAt: string | null;
}

export interface ProjectTask {
  id: number;
  title: string;
  description: string | null;
  assignee: ProjectUserRef | null;
  dueDate: string | null;
  position: number;
  status: ProjectItemStatus;
  note: string | null;
  doneByName: string | null;
  doneAt: string | null;
  overdue: boolean;
  canUpdate: boolean;
}

export interface ProjectDetail {
  id: number;
  name: string;
  description: string;
  status: ProjectStatus;
  phase: ProjectPhase;
  owner: ProjectUserRef | null;
  recurrence: ProjectRecurrence;
  recurrenceInterval: number;
  cycle: number;
  startDate: string | null;
  dueDate: string | null;
  nextStartDate: string | null;
  clients: ProjectRef[];
  sites: ProjectSite[];
  agents: ProjectAgent[];
  tasks: ProjectTask[];
  progress: ProjectProgress;
  closedCycles: number;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  /** manage: editar tudo; record: registrar andamento e documentar. */
  can: { manage: boolean; record: boolean };
}

export interface ProjectAttachment {
  id: number;
  fileName: string;
  contentType: string;
  size: number;
}

export interface ProjectNote {
  id: number;
  cycle: number;
  kind: ProjectNoteKind;
  projectAgentId: number | null;
  projectTaskId: number | null;
  subject: string | null;
  itemStatus: ProjectItemStatus | null;
  body: string;
  authorId: string | null;
  authorName: string;
  createdAt: string;
  attachments: ProjectAttachment[];
  canDelete: boolean;
}

export interface ProjectCycleItem {
  kind: 'agent' | 'task';
  title: string;
  detail: string | null;
  status: ProjectItemStatus;
  note: string | null;
  doneByName: string | null;
  doneAt: string | null;
}

export interface ProjectCycle {
  id: number;
  number: number;
  startDate: string | null;
  dueDate: string | null;
  closedAt: string;
  closedByName: string;
  summary: string | null;
  items: ProjectCycleItem[];
}

export interface ProjectOptionClient {
  id: number;
  name: string;
  sites: { id: number; name: string }[];
}

export interface ProjectOptionAgent {
  id: number;
  hostname: string;
  clientId: number;
  siteId: number;
  description: string | null;
  status: string;
}

export interface ProjectOptions {
  users: ProjectUserRef[];
  clients: ProjectOptionClient[];
  agents: ProjectOptionAgent[];
}

export interface AgentProject {
  id: number;
  name: string;
  phase: ProjectPhase;
  cycle: number;
  dueDate: string | null;
  itemStatus: ProjectItemStatus;
  doneByName: string | null;
  doneAt: string | null;
}

export interface SaveProjectTaskRequest {
  title: string;
  description?: string | null;
  assigneeId?: string | null;
  dueDate?: string | null;
}

export interface SaveProjectRequest {
  name: string;
  description?: string | null;
  ownerId?: string | null;
  recurrence: ProjectRecurrence;
  recurrenceInterval?: number;
  startDate?: string | null;
  dueDate?: string | null;
  clientIds: number[];
  siteIds: number[];
  agentIds: number[];
  /** Só na criação. */
  tasks?: SaveProjectTaskRequest[];
}

export interface ProjectProgressRequest {
  agentRowIds?: number[];
  taskIds?: number[];
  status: ProjectItemStatus;
  note?: string | null;
}

export interface CreateProjectNoteRequest {
  body?: string | null;
  projectAgentId?: number | null;
  projectTaskId?: number | null;
  status?: ProjectItemStatus | null;
}

export interface ListProjectsParams {
  status?: ProjectListStatus;
  clientId?: number;
  search?: string;
  mine?: boolean;
}

export interface ListProjectNotesParams {
  cycle?: number;
  projectAgentId?: number;
  projectTaskId?: number;
}

const base = (id: number) => `/api/projects/${encodeURIComponent(String(id))}`;

export const projectsApi = {
  list: (params: ListProjectsParams, options?: { silent?: boolean }) => api.get<ProjectSummary[]>('/api/projects', { ...params }, options),
  options: () => api.get<ProjectOptions>('/api/projects/options'),
  get: (id: number) => api.get<ProjectDetail>(base(id)),
  create: (body: SaveProjectRequest) => api.post<ProjectDetail>('/api/projects', body),
  update: (id: number, body: SaveProjectRequest) => api.put<ProjectDetail>(base(id), body),
  remove: (id: number) => api.delete(base(id)),
  setStatus: (id: number, status: ProjectStatus) => api.put<ProjectDetail>(`${base(id)}/status`, { status }),
  addTask: (id: number, body: SaveProjectTaskRequest) => api.post<{ id: number }>(`${base(id)}/tasks`, body),
  updateTask: (id: number, taskId: number, body: SaveProjectTaskRequest) => api.put(`${base(id)}/tasks/${taskId}`, body),
  removeTask: (id: number, taskId: number) => api.delete(`${base(id)}/tasks/${taskId}`),
  progress: (id: number, body: ProjectProgressRequest) => api.put(`${base(id)}/progress`, body),
  notes: (id: number, params: ListProjectNotesParams = {}) => api.get<ProjectNote[]>(`${base(id)}/notes`, { ...params }),
  addNote: (id: number, body: CreateProjectNoteRequest) => api.post<ProjectNote>(`${base(id)}/notes`, body),
  removeNote: (id: number, noteId: number) => api.delete(`${base(id)}/notes/${noteId}`),
  upload: (id: number, noteId: number, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post<ProjectAttachment>(`${base(id)}/notes/${noteId}/attachments`, form);
  },
  /** Link comum: o cookie de sessão vai junto; imagens abrem no navegador, o resto baixa. */
  attachmentUrl: (id: number, attachmentId: number) => `${base(id)}/attachments/${attachmentId}`,
  cycles: (id: number) => api.get<ProjectCycle[]>(`${base(id)}/cycles`),
  closeCycle: (id: number, body: { summary?: string | null; finish?: boolean }) => api.post<ProjectDetail>(`${base(id)}/cycles`, body),
  forAgent: (agentId: number) => api.get<AgentProject[]>(`/api/agents/${encodeURIComponent(String(agentId))}/projects`),
};
