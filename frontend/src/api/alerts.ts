import { api, type RequestOptions } from './client';
import type {
  AlertDto,
  AlertTemplateDto,
  BulkAlertRequest,
  ListAlertsParams,
  Paged,
  SaveAlertTemplateRequest,
  TemplateAssignmentRequest,
  TemplateAssignmentsDto,
} from './types';

type Silent = Pick<RequestOptions, 'silent'>;

export const alertsApi = {
  list: (params: ListAlertsParams) => api.get<Paged<AlertDto>>('/api/alerts', { ...params }),
  resolve: (id: number) => api.post(`/api/alerts/${id}/resolve`),
  snooze: (id: number, until: string) => api.post(`/api/alerts/${id}/snooze`, { until }),
  bulk: (body: BulkAlertRequest, options?: Silent) => api.post('/api/alerts/bulk', body, options),
};

export const alertTemplatesApi = {
  list: () => api.get<AlertTemplateDto[]>('/api/alert-templates'),
  create: (body: SaveAlertTemplateRequest) => api.post<AlertTemplateDto>('/api/alert-templates', body),
  update: (id: number, body: SaveAlertTemplateRequest) => api.put<AlertTemplateDto>(`/api/alert-templates/${id}`, body),
  remove: (id: number) => api.delete(`/api/alert-templates/${id}`),
  assignments: () => api.get<TemplateAssignmentsDto>('/api/alert-templates/assignments'),
  assign: (body: TemplateAssignmentRequest) => api.put('/api/alert-templates/assignments', body),
};
