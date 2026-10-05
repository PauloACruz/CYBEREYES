import { api, type RequestOptions } from './client';
import type { CareCatalog, CareRunDto, HealthReport, Paged, SelfServiceSettings, StartCareRunRequest } from './types';

type Silent = Pick<RequestOptions, 'silent'>;

export const careApi = {
  catalog: (agentId: number, options?: Silent) => api.get<CareCatalog>(`/api/agents/${agentId}/care/catalog`, undefined, options),
  start: (agentId: number, body: StartCareRunRequest, options?: Silent) =>
    api.post<CareRunDto>(`/api/agents/${agentId}/care/runs`, body, options),
  runs: (agentId: number, page: number, pageSize: number) =>
    api.get<Paged<CareRunDto>>(`/api/agents/${agentId}/care/runs`, { page, pageSize }),
  run: (runId: string) => api.get<CareRunDto>(`/api/care/runs/${encodeURIComponent(runId)}`),
  cancel: (runId: string) => api.post<undefined>(`/api/care/runs/${encodeURIComponent(runId)}/cancel`),
  health: (agentId: number, options?: Silent) => api.get<HealthReport>(`/api/agents/${agentId}/health`, undefined, options),
  collectHealth: (agentId: number) => api.post<HealthReport>(`/api/agents/${agentId}/health`),
  selfService: () => api.get<SelfServiceSettings>('/api/care/self-service'),
  saveSelfService: (body: SelfServiceSettings) => api.put<SelfServiceSettings>('/api/care/self-service', body),
};
