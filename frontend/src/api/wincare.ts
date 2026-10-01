import { api, type RequestOptions } from './client';
import type { HealthReport, Paged, SelfServiceSettings, StartWinCareRunRequest, WinCareCatalog, WinCareRunDto } from './types';

type Silent = Pick<RequestOptions, 'silent'>;

export const wincareApi = {
  catalog: (agentId: number, options?: Silent) => api.get<WinCareCatalog>(`/api/agents/${agentId}/wincare/catalog`, undefined, options),
  start: (agentId: number, body: StartWinCareRunRequest, options?: Silent) =>
    api.post<WinCareRunDto>(`/api/agents/${agentId}/wincare/runs`, body, options),
  runs: (agentId: number, page: number, pageSize: number) =>
    api.get<Paged<WinCareRunDto>>(`/api/agents/${agentId}/wincare/runs`, { page, pageSize }),
  run: (runId: string) => api.get<WinCareRunDto>(`/api/wincare/runs/${encodeURIComponent(runId)}`),
  cancel: (runId: string) => api.post<undefined>(`/api/wincare/runs/${encodeURIComponent(runId)}/cancel`),
  health: (agentId: number, options?: Silent) => api.get<HealthReport>(`/api/agents/${agentId}/health`, undefined, options),
  collectHealth: (agentId: number) => api.post<HealthReport>(`/api/agents/${agentId}/health`),
  selfService: () => api.get<SelfServiceSettings>('/api/wincare/self-service'),
  saveSelfService: (body: SelfServiceSettings) => api.put<SelfServiceSettings>('/api/wincare/self-service', body),
};
