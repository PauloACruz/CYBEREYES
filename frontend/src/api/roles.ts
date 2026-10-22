import { api, type RequestOptions } from './client';
import type { ClientRef, PermissionDto, RoleDto, RoleRef, SaveRoleRequest } from './types';

export const rolesApi = {
  list: (options?: Pick<RequestOptions, 'silent'>) => api.get<RoleDto[]>('/api/roles', undefined, options),
  options: () => api.get<RoleRef[]>('/api/roles/options'),
  permissions: () => api.get<PermissionDto[]>('/api/roles/permissions'),
  /** Clientes que quem edita pode liberar ao papel (os que ele próprio vê). */
  clientOptions: () => api.get<ClientRef[]>('/api/roles/client-options'),
  create: (body: SaveRoleRequest) => api.post<RoleDto>('/api/roles', body),
  update: (id: string, body: SaveRoleRequest) => api.put<RoleDto>(`/api/roles/${encodeURIComponent(id)}`, body),
  remove: (id: string) => api.delete(`/api/roles/${encodeURIComponent(id)}`),
};
