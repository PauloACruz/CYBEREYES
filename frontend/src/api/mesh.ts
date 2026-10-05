import { api } from './client';
import type { MeshStatusDto, MeshSyncResult, RdpAccessDto, RemoteAccessDto } from './types';

export const meshApi = {
  remote: (id: number) => api.get<RemoteAccessDto>(`/api/agents/${id}/remote`, undefined, { silent: true }),
  rdp: (id: number) => api.post<RdpAccessDto>(`/api/agents/${id}/remote/rdp`, undefined, { silent: true }),
  wake: (id: number) => api.post(`/api/agents/${id}/wake`),
  recover: (id: number) => api.post(`/api/agents/${id}/mesh/recover`),
  status: () => api.get<MeshStatusDto>('/api/mesh/status'),
  sync: () => api.post<MeshSyncResult>('/api/mesh/sync'),
};
