import { api } from './client';
import type { IncludeProceduresRequest, ListProceduresParams, ProcedureDto, ProcedurePage, ProceduresTicketRequest } from './types';

export const proceduresApi = {
  list: (params: ListProceduresParams) => api.get<ProcedurePage>('/api/procedures', { ...params }),
  forTicket: (ticketId: number) => api.get<ProcedureDto[]>(`/api/tickets/${ticketId}/procedures`),
  include: (ticketId: number, body: IncludeProceduresRequest) => api.post<ProcedureDto[]>(`/api/tickets/${ticketId}/procedures`, body),
  remove: (ticketId: number, procedureId: number) => api.delete(`/api/tickets/${ticketId}/procedures/${procedureId}`),
  createTicket: (body: ProceduresTicketRequest) => api.post<{ id: number }>('/api/procedures/ticket', body),
};
