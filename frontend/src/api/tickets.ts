import { api } from './client';
import type {
  ChangeTicketStatusRequest,
  CreateTicketMessageRequest,
  CreateTicketRequest,
  CreateTimeEntryRequest,
  IncidentSettingsDto,
  ListTicketsParams,
  Paged,
  SaveTicketQueueRequest,
  SlaRuleDto,
  TicketAssignee,
  TicketAttachmentDto,
  TicketDetail,
  TicketListItem,
  TicketMessageDto,
  TicketQueueDto,
  TicketSummary,
  TimeEntryDto,
  UpdateTicketRequest,
} from './types';

export function ticketAttachmentUrl(ticketId: number, attachmentId: number): string {
  return `/api/tickets/${ticketId}/attachments/${attachmentId}`;
}

export const ticketsApi = {
  list: (params: ListTicketsParams) => api.get<Paged<TicketListItem>>('/api/tickets', { ...params }),
  summary: () => api.get<TicketSummary>('/api/tickets/summary'),
  get: (id: number) => api.get<TicketDetail>(`/api/tickets/${id}`),
  create: (body: CreateTicketRequest) => api.post<TicketDetail>('/api/tickets', body),
  update: (id: number, body: UpdateTicketRequest) => api.patch<TicketDetail>(`/api/tickets/${id}`, body),
  setStatus: (id: number, body: ChangeTicketStatusRequest) => api.put<TicketDetail>(`/api/tickets/${id}/status`, body),
  assign: (id: number, userId: string | null) => api.put<TicketDetail>(`/api/tickets/${id}/assign`, { userId }),
  assignees: () => api.get<TicketAssignee[]>('/api/tickets/assignees'),
  forAgent: (agentId: number) => api.get<TicketListItem[]>(`/api/agents/${agentId}/tickets`),
  messages: (id: number) => api.get<TicketMessageDto[]>(`/api/tickets/${id}/messages`),
  sendMessage: (id: number, body: CreateTicketMessageRequest) => api.post<TicketMessageDto>(`/api/tickets/${id}/messages`, body),
  attachments: (id: number) => api.get<TicketAttachmentDto[]>(`/api/tickets/${id}/attachments`),
  /** Com messageId o anexo herda a visibilidade da mensagem; sem ela vale o campo internal. */
  upload: (id: number, file: File, target: { messageId: number } | { internal: boolean }) => {
    const form = new FormData();
    form.append('file', file);
    if ('messageId' in target) form.append('messageId', String(target.messageId));
    else form.append('internal', String(target.internal));
    return api.post<TicketAttachmentDto>(`/api/tickets/${id}/attachments`, form);
  },
  time: (id: number) => api.get<TimeEntryDto[]>(`/api/tickets/${id}/time`),
  addTime: (id: number, body: CreateTimeEntryRequest) => api.post<TimeEntryDto>(`/api/tickets/${id}/time`, body),
  removeTime: (id: number, entryId: number) => api.delete(`/api/tickets/${id}/time/${entryId}`),
  sla: () => api.get<SlaRuleDto[]>('/api/tickets/sla'),
  saveSla: (rules: SlaRuleDto[]) => api.put<SlaRuleDto[]>('/api/tickets/sla', rules),
  incidentSettings: () => api.get<IncidentSettingsDto>('/api/tickets/incident-settings'),
  saveIncidentSettings: (body: IncidentSettingsDto) => api.put<IncidentSettingsDto>('/api/tickets/incident-settings', body),
};

export const ticketQueuesApi = {
  list: () => api.get<TicketQueueDto[]>('/api/ticket-queues'),
  create: (body: SaveTicketQueueRequest) => api.post<TicketQueueDto>('/api/ticket-queues', body),
  update: (id: number, body: SaveTicketQueueRequest) => api.put<TicketQueueDto>(`/api/ticket-queues/${id}`, body),
  remove: (id: number) => api.delete(`/api/ticket-queues/${id}`),
};
