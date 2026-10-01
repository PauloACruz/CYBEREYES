import { api, type RequestOptions } from './client';
import type { ClientDto, CreateClientRequest, NameRequest, SiteDto } from './types';

type Silent = Pick<RequestOptions, 'silent'>;

export const clientsApi = {
  list: () => api.get<ClientDto[]>('/api/clients'),
  create: (body: CreateClientRequest) => api.post<ClientDto>('/api/clients', body),
  rename: (id: number, body: NameRequest) => api.put(`/api/clients/${id}`, body),
  remove: (id: number, options?: Silent) => api.delete(`/api/clients/${id}`, options),
  addSite: (clientId: number, body: NameRequest) => api.post<SiteDto>(`/api/clients/${clientId}/sites`, body),
  renameSite: (id: number, body: NameRequest) => api.put(`/api/sites/${id}`, body),
  removeSite: (id: number, options?: Silent) => api.delete(`/api/sites/${id}`, options),
};
