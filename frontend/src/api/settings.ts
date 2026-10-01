import { api } from './client';
import type {
  GlobalSettingsDto,
  KeyDto,
  SaveGlobalSettingsRequest,
  SaveKeyRequest,
  SaveUrlActionRequest,
  SuccessMessage,
  UrlActionDto,
} from './types';

export const keystoreApi = {
  list: () => api.get<KeyDto[]>('/api/keystore'),
  create: (body: SaveKeyRequest) => api.post<KeyDto>('/api/keystore', body),
  update: (id: number, body: SaveKeyRequest) => api.put<KeyDto>(`/api/keystore/${id}`, body),
  remove: (id: number) => api.delete(`/api/keystore/${id}`),
};

export const urlActionsApi = {
  list: () => api.get<UrlActionDto[]>('/api/url-actions'),
  create: (body: SaveUrlActionRequest) => api.post<UrlActionDto>('/api/url-actions', body),
  update: (id: number, body: SaveUrlActionRequest) => api.put<UrlActionDto>(`/api/url-actions/${id}`, body),
  remove: (id: number) => api.delete(`/api/url-actions/${id}`),
};

export const globalSettingsApi = {
  get: () => api.get<GlobalSettingsDto>('/api/settings'),
  save: (body: SaveGlobalSettingsRequest) => api.put<GlobalSettingsDto>('/api/settings', body),
  testEmail: (to: string) => api.post<SuccessMessage>('/api/settings/test-email', { to }),
  testWebhook: (url: string) => api.post<SuccessMessage>('/api/settings/test-webhook', { url }),
};
