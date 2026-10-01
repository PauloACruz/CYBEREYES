import { api } from './client';
import type { ApiKeyDto, CreateApiKeyRequest, CreatedApiKeyDto } from './types';

export const apiKeysApi = {
  list: () => api.get<ApiKeyDto[]>('/api/apikeys'),
  create: (body: CreateApiKeyRequest) => api.post<CreatedApiKeyDto>('/api/apikeys', body),
  revoke: (id: string) => api.delete(`/api/apikeys/${encodeURIComponent(id)}`),
};
