import { api } from './client';
import type { CreateRemoteSessionRequest, RemotePolicyDto, RemotePolicyScope, RemoteSessionDto, RemoteSessionPage } from './types';

export const remoteApi = {
  createSession: (agentId: number, body: CreateRemoteSessionRequest) =>
    api.post<RemoteSessionDto>(`/api/agents/${agentId}/remote/sessions`, body, { silent: true }),
  session: (sessionId: string) => api.get<RemoteSessionDto>(`/api/remote/sessions/${sessionId}`),
  endSession: (sessionId: string) => api.delete(`/api/remote/sessions/${sessionId}`, { silent: true }),
  sessions: (query: { agentId?: number; ticketId?: number; active?: boolean; page?: number }) => api.get<RemoteSessionPage>('/api/remote/sessions', query),
  policies: () => api.get<RemotePolicyDto[]>('/api/remote/policies'),
  savePolicy: (scope: RemotePolicyScope, scopeId: number, body: Partial<RemotePolicyDto>) =>
    api.put<RemotePolicyDto>(scope === 'global' ? '/api/remote/policies/global' : `/api/remote/policies/${scope}/${scopeId}`, { ...body, scope, scopeId }),
  deletePolicy: (scope: RemotePolicyScope, scopeId: number) => api.delete(`/api/remote/policies/${scope}/${scopeId}`),
};
