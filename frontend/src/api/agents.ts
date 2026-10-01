import { api } from './client';
import type { AgentDetail, AgentListItem, InstallerRequest, InstallerResponse, ListAgentsParams, Paged, PingResponse } from './types';

export const agentsApi = {
  list: (params: ListAgentsParams) => api.get<Paged<AgentListItem>>('/api/agents', { ...params }),
  get: (id: number) => api.get<AgentDetail>(`/api/agents/${id}`),
  ping: (id: number) => api.post<PingResponse>(`/api/agents/${id}/ping`),
  remove: (id: number) => api.delete(`/api/agents/${id}`),
  installer: (body: InstallerRequest) => api.post<InstallerResponse>('/api/agents/installer', body),
};
