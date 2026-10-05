import { api, request } from './client';
import type {
  CreateRemoteSessionRequest,
  RemoteFileEntry,
  RemoteHomeDto,
  RemotePolicyDto,
  RemotePolicyScope,
  RemoteSessionDto,
  RemoteSessionPage,
} from './types';

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

const sessionPath = (sessionId: string) => `/api/remote/sessions/${encodeURIComponent(sessionId)}`;

/** Arquivos da estacao pela sessao remota (contrato, secoes 2.1 e 7). */
export const remoteFilesApi = {
  home: (sessionId: string) => api.get<RemoteHomeDto>(`${sessionPath(sessionId)}/files/home`, undefined),
  list: (sessionId: string, path: string) => api.get<RemoteFileEntry[]>(`${sessionPath(sessionId)}/files/list`, { path }),
  mkdir: (sessionId: string, path: string) => api.post<undefined>(`${sessionPath(sessionId)}/files/mkdir`, { path }),
  rename: (sessionId: string, from: string, to: string) => api.post<undefined>(`${sessionPath(sessionId)}/files/rename`, { from, to }),
  remove: (sessionId: string, path: string, recursive: boolean) => api.post<undefined>(`${sessionPath(sessionId)}/files/delete`, { path, recursive }),
  clipboard: (sessionId: string, transferIds: number[]) => api.post<undefined>(`${sessionPath(sessionId)}/files/clipboard`, { transferIds }, { silent: true }),
  beginUpload: (sessionId: string, path: string, size: number, overwrite: boolean) =>
    api.post<{ transferId: number; received: number }>(`${sessionPath(sessionId)}/uploads`, { path, size, overwrite }, { silent: true }),
  putChunk: (sessionId: string, transferId: number, chunk: Blob, from: number, total: number, signal?: AbortSignal) =>
    request<{ received: number }>(`${sessionPath(sessionId)}/uploads/${transferId}`, {
      method: 'PUT',
      body: chunk,
      headers: { 'Content-Range': `bytes ${from}-${from + chunk.size - 1}/${total}` },
      signal,
      silent: true,
    }),
  completeUpload: (sessionId: string, transferId: number) =>
    api.post<{ transferId: number; sha256: string; path: string }>(`${sessionPath(sessionId)}/uploads/${transferId}/complete`, undefined, { silent: true }),
  /** Endereco do download (o navegador baixa direto, com o cookie da sessao). */
  downloadUrl: (sessionId: string, paths: string[], zip = false) =>
    `${sessionPath(sessionId)}/download?${[...paths.map((p) => `path=${encodeURIComponent(p)}`), ...(zip ? ['zip=true'] : [])].join('&')}`,
};
