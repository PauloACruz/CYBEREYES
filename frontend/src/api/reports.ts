import { api, type RequestOptions } from './client';
import type {
  GenerateReportRequest,
  ListReportRunsParams,
  Paged,
  ReportData,
  ReportParams,
  ReportRunDto,
  ReportScheduleDto,
  ReportTypeDto,
  SaveReportSchedule,
  TicketAssignee,
} from './types';

/** Download pelo navegador (link comum): o cookie de sessao vai junto. */
export function reportDownloadUrl(runId: number): string {
  return `/api/reports/runs/${encodeURIComponent(String(runId))}/download`;
}

export const reportsApi = {
  types: () => api.get<ReportTypeDto[]>('/api/reports/types'),
  preview: (params: ReportParams, options?: Pick<RequestOptions, 'silent'>) => api.post<ReportData>('/api/reports/preview', params, options),
  generate: (body: GenerateReportRequest, options?: Pick<RequestOptions, 'silent'>) => api.post<ReportRunDto>('/api/reports/runs', body, options),
  runs: (params: ListReportRunsParams) => api.get<Paged<ReportRunDto>>('/api/reports/runs', { ...params }),
  removeRun: (id: number) => api.delete(`/api/reports/runs/${encodeURIComponent(String(id))}`),
  schedules: () => api.get<ReportScheduleDto[]>('/api/reports/schedules'),
  createSchedule: (body: SaveReportSchedule) => api.post<ReportScheduleDto>('/api/reports/schedules', body),
  updateSchedule: (id: number, body: SaveReportSchedule) =>
    api.put<ReportScheduleDto>(`/api/reports/schedules/${encodeURIComponent(String(id))}`, body),
  removeSchedule: (id: number) => api.delete(`/api/reports/schedules/${encodeURIComponent(String(id))}`),
  /** Tecnicos para o filtro do relatorio de chamados; erro tratado na tela (sem notificacao). */
  assignees: () => api.get<TicketAssignee[]>('/api/tickets/assignees', undefined, { silent: true }),
  runSchedule: (id: number) => api.post<ReportRunDto>(`/api/reports/schedules/${encodeURIComponent(String(id))}/run`),
};
