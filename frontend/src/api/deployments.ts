import { api } from './client';
import type { CreateDeploymentRequest, DeploymentDto } from './types';

export const deploymentsApi = {
  list: () => api.get<DeploymentDto[]>('/api/deployments'),
  create: (body: CreateDeploymentRequest) => api.post<DeploymentDto>('/api/deployments', body),
  remove: (id: number) => api.delete(`/api/deployments/${id}`),
};
