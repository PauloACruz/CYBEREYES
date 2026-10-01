import { api, type RequestOptions } from './client';
import type {
  AgentHistoryDto,
  CommandRequest,
  CommandResponse,
  EventLogEntry,
  EventLogName,
  Paged,
  ProcessDto,
  RegistryListing,
  RegistryValueRequest,
  RunScriptRequest,
  RunScriptResponse,
  ServiceAction,
  ServiceStartType,
  SuccessMessage,
  UrlResponse,
  WindowsServiceDto,
} from './types';

type Silent = Pick<RequestOptions, 'silent'>;

const base = (id: number) => `/api/agents/${id}`;

export const agentActionsApi = {
  history: (id: number, page: number, pageSize: number) =>
    api.get<Paged<AgentHistoryDto>>(`${base(id)}/history`, { page, pageSize }),
  command: (id: number, body: CommandRequest, options?: Silent) =>
    api.post<CommandResponse>(`${base(id)}/command`, body, options),
  runScript: (id: number, body: RunScriptRequest, options?: Silent) =>
    api.post<RunScriptResponse>(`${base(id)}/runscript`, body, options),

  processes: (id: number) => api.get<ProcessDto[]>(`${base(id)}/processes`),
  killProcess: (id: number, pid: number) => api.delete(`${base(id)}/processes/${pid}`),

  services: (id: number) => api.get<WindowsServiceDto[]>(`${base(id)}/services`),
  serviceAction: (id: number, name: string, action: ServiceAction) =>
    api.post<SuccessMessage>(`${base(id)}/services/${encodeURIComponent(name)}/action`, { action }),
  serviceStartType: (id: number, name: string, startType: ServiceStartType) =>
    api.put<SuccessMessage>(`${base(id)}/services/${encodeURIComponent(name)}/start-type`, { startType }),

  eventLog: (id: number, logName: EventLogName, days: number) =>
    api.get<EventLogEntry[]>(`${base(id)}/eventlog/${logName}`, { days }),

  registry: (id: number, path: string, page: number) =>
    api.get<RegistryListing>(`${base(id)}/registry`, { path, page }),
  createKey: (id: number, path: string) => api.post(`${base(id)}/registry/keys`, { path }),
  deleteKey: (id: number, path: string) => api.delete(`${base(id)}/registry/keys`, { query: { path } }),
  renameKey: (id: number, oldPath: string, newPath: string) =>
    api.put(`${base(id)}/registry/keys/rename`, { oldPath, newPath }),
  createValue: (id: number, body: RegistryValueRequest) => api.post(`${base(id)}/registry/values`, body),
  updateValue: (id: number, body: RegistryValueRequest) => api.put(`${base(id)}/registry/values`, body),
  renameValue: (id: number, path: string, oldName: string, newName: string) =>
    api.put(`${base(id)}/registry/values/rename`, { path, oldName, newName }),
  deleteValue: (id: number, path: string, name: string) =>
    api.delete(`${base(id)}/registry/values`, { query: { path, name } }),

  reboot: (id: number) => api.post(`${base(id)}/reboot`),
  shutdown: (id: number) => api.post(`${base(id)}/shutdown`),
  refresh: (id: number) => api.post(`${base(id)}/refresh`),
  urlAction: (id: number, actionId: number) => api.get<UrlResponse>(`${base(id)}/url-actions/${actionId}`),
};
