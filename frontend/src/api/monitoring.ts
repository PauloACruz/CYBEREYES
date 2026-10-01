import { api, type RequestOptions } from './client';
import type {
  AgentCheckDto,
  AgentPatchPolicyDto,
  AgentTaskDto,
  BlockInheritanceRequest,
  CheckDto,
  CheckHistoryPoint,
  EffectivePolicyDto,
  PatchPolicy,
  PendingActionDto,
  PolicyAssignmentRequest,
  PolicyAssignmentsDto,
  PolicyDetailDto,
  PolicyDto,
  SaveCheckRequest,
  SavePolicyRequest,
  SaveTaskRequest,
  SoftwareInventory,
  TaskDto,
  UpdateAction,
  WinUpdateDto,
} from './types';

type Silent = Pick<RequestOptions, 'silent'>;

const agent = (id: number) => `/api/agents/${id}`;

export const checksApi = {
  forAgent: (agentId: number) => api.get<AgentCheckDto[]>(`${agent(agentId)}/checks`),
  create: (body: SaveCheckRequest) => api.post<CheckDto>('/api/checks', body),
  update: (id: number, body: SaveCheckRequest) => api.put<CheckDto>(`/api/checks/${id}`, body),
  remove: (id: number) => api.delete(`/api/checks/${id}`),
  history: (id: number, agentId: number, hours: number) =>
    api.get<CheckHistoryPoint[]>(`/api/checks/${id}/history`, { agentId, hours }),
  runAll: (agentId: number) => api.post(`${agent(agentId)}/checks/run`),
};

export const tasksApi = {
  forAgent: (agentId: number) => api.get<AgentTaskDto[]>(`${agent(agentId)}/tasks`),
  create: (body: SaveTaskRequest) => api.post<TaskDto>('/api/tasks', body),
  update: (id: number, body: SaveTaskRequest) => api.put<TaskDto>(`/api/tasks/${id}`, body),
  remove: (id: number) => api.delete(`/api/tasks/${id}`),
  run: (agentId: number, taskId: number) => api.post(`${agent(agentId)}/tasks/${taskId}/run`),
};

export const policiesApi = {
  list: () => api.get<PolicyDto[]>('/api/policies'),
  get: (id: number) => api.get<PolicyDetailDto>(`/api/policies/${id}`),
  create: (body: SavePolicyRequest) => api.post<PolicyDto>('/api/policies', body),
  update: (id: number, body: SavePolicyRequest) => api.put<PolicyDto>(`/api/policies/${id}`, body),
  remove: (id: number) => api.delete(`/api/policies/${id}`),
  assignments: () => api.get<PolicyAssignmentsDto>('/api/policies/assignments'),
  assign: (body: PolicyAssignmentRequest) => api.put('/api/policies/assignments', body),
  blockInheritance: (body: BlockInheritanceRequest) => api.put('/api/policies/block-inheritance', body),
  forAgent: (agentId: number) => api.get<EffectivePolicyDto[]>(`${agent(agentId)}/policies`),
  patchPolicy: (id: number) => api.get<PatchPolicy | null>(`/api/policies/${id}/patch-policy`),
  savePatchPolicy: (id: number, body: PatchPolicy) => api.put<PatchPolicy>(`/api/policies/${id}/patch-policy`, body),
};

export const patchesApi = {
  list: (agentId: number) => api.get<WinUpdateDto[]>(`${agent(agentId)}/updates`),
  setAction: (agentId: number, updateId: number, action: UpdateAction) =>
    api.put(`${agent(agentId)}/updates/${updateId}`, { action }),
  scan: (agentId: number) => api.post(`${agent(agentId)}/updates/scan`),
  install: (agentId: number) => api.post(`${agent(agentId)}/updates/install`),
  agentPolicy: (agentId: number) => api.get<AgentPatchPolicyDto>(`${agent(agentId)}/patch-policy`),
  saveAgentPolicy: (agentId: number, body: PatchPolicy) => api.put<PatchPolicy>(`${agent(agentId)}/patch-policy`, body),
  removeAgentPolicy: (agentId: number) => api.delete(`${agent(agentId)}/patch-policy`),
};

export const softwareApi = {
  list: (agentId: number) => api.get<SoftwareInventory>(`${agent(agentId)}/software`),
  refresh: (agentId: number, options?: Silent) => api.post<SoftwareInventory>(`${agent(agentId)}/software/refresh`, undefined, options),
  install: (agentId: number, pkg: string) => api.post<{ pendingActionId: number }>(`${agent(agentId)}/software/install`, { package: pkg }),
  pendingActions: (agentId: number) => api.get<PendingActionDto[]>(`${agent(agentId)}/pending-actions`),
};
