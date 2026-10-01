import { api } from './client';
import type { SaveScriptRequest, SaveSnippetRequest, ScriptDto, SnippetDto } from './types';

export const scriptsApi = {
  list: () => api.get<ScriptDto[]>('/api/scripts'),
  get: (id: number) => api.get<ScriptDto>(`/api/scripts/${id}`),
  create: (body: SaveScriptRequest) => api.post<ScriptDto>('/api/scripts', body),
  update: (id: number, body: SaveScriptRequest) => api.put<ScriptDto>(`/api/scripts/${id}`, body),
  remove: (id: number) => api.delete(`/api/scripts/${id}`),
  snippets: () => api.get<SnippetDto[]>('/api/scripts/snippets'),
  createSnippet: (body: SaveSnippetRequest) => api.post<SnippetDto>('/api/scripts/snippets', body),
  updateSnippet: (id: number, body: SaveSnippetRequest) => api.put<SnippetDto>(`/api/scripts/snippets/${id}`, body),
  removeSnippet: (id: number) => api.delete(`/api/scripts/snippets/${id}`),
};
