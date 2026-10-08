import { api } from './client';
import type { ClientRef, CreateUserRequest, ListUsersParams, Paged, ResetPasswordRequest, UpdateUserRequest, UserDto } from './types';

export const usersApi = {
  list: (params: ListUsersParams) => api.get<Paged<UserDto>>('/api/users', { ...params }),
  /** Clientes que quem edita pode liberar (os que ele próprio vê). */
  clientOptions: () => api.get<ClientRef[]>('/api/users/client-options'),
  get: (id: string) => api.get<UserDto>(`/api/users/${encodeURIComponent(id)}`),
  create: (body: CreateUserRequest) => api.post<UserDto>('/api/users', body),
  update: (id: string, body: UpdateUserRequest) => api.put<UserDto>(`/api/users/${encodeURIComponent(id)}`, body),
  resetPassword: (id: string, body: ResetPasswordRequest) =>
    api.post<undefined>(`/api/users/${encodeURIComponent(id)}/reset-password`, body),
  resendInvite: (id: string) => api.post<undefined>(`/api/users/${encodeURIComponent(id)}/invite`),
  resetTwoFactor: (id: string) => api.post<undefined>(`/api/users/${encodeURIComponent(id)}/reset-2fa`),
  remove: (id: string) => api.delete(`/api/users/${encodeURIComponent(id)}`),
  removeSsoLogin: (id: string, providerId: number) =>
    api.delete(`/api/users/${encodeURIComponent(id)}/sso/${encodeURIComponent(String(providerId))}`),
};
