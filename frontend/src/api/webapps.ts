import { api, type RequestOptions } from './client';
import type {
  AppCommandDto,
  AppRunDetail,
  AppRunDto,
  AppServerDto,
  AppServerTestResult,
  ListAppRunsParams,
  ListWebAppsParams,
  Paged,
  ProbeResultDto,
  RevealedServerSecret,
  RunCommandRequest,
  SaveAppCommandRequest,
  SaveAppServerRequest,
  SaveWebAppRequest,
  WebAppChecksDto,
  WebAppDetail,
  WebAppsOverview,
} from './types';

type Silent = Pick<RequestOptions, 'silent'>;

export interface StartedRun {
  id: number;
  status: string;
}

export const webAppsApi = {
  overview: (params: ListWebAppsParams = {}, options?: Silent) => api.get<WebAppsOverview>('/api/webapps/overview', { ...params }, options),
  detail: (id: number) => api.get<WebAppDetail>(`/api/webapps/${id}`),
  create: (body: SaveWebAppRequest) => api.post<WebAppDetail>('/api/webapps', body),
  update: (id: number, body: SaveWebAppRequest) => api.put<WebAppDetail>(`/api/webapps/${id}`, body),
  remove: (id: number) => api.delete(`/api/webapps/${id}`),
  checkNow: (id: number) => api.post<ProbeResultDto | null>(`/api/webapps/${id}/check`),
  checks: (id: number, hours: number) => api.get<WebAppChecksDto>(`/api/webapps/${id}/checks`, { hours }),
  deploy: (id: number) => api.post<StartedRun>(`/api/webapps/${id}/deploy`),
};

export const appServersApi = {
  get: (id: number) => api.get<AppServerDto>(`/api/webapps/servers/${id}`),
  create: (body: SaveAppServerRequest) => api.post<AppServerDto>('/api/webapps/servers', body),
  update: (id: number, body: SaveAppServerRequest) => api.put<AppServerDto>(`/api/webapps/servers/${id}`, body),
  remove: (id: number) => api.delete(`/api/webapps/servers/${id}`),
  /** Testa os dados do formulario; com id, campos de segredo vazios usam os salvos. */
  testDraft: (body: SaveAppServerRequest & { id?: number }) =>
    api.post<AppServerTestResult>('/api/webapps/servers/test', body, { silent: true }),
  test: (id: number) => api.post<AppServerTestResult>(`/api/webapps/servers/${id}/test`, undefined, { silent: true }),
  resetHostKey: (id: number) => api.post(`/api/webapps/servers/${id}/reset-host-key`),
  /** Gera auditoria app-server.secret-reveal no servidor. */
  reveal: (id: number) => api.post<RevealedServerSecret>(`/api/webapps/servers/${id}/reveal`),
  run: (id: number, body: RunCommandRequest) => api.post<StartedRun>(`/api/webapps/servers/${id}/run`, body),
};

export const appCommandsApi = {
  list: (params: { serverId?: number; webAppId?: number }) => api.get<AppCommandDto[]>('/api/webapps/commands', { ...params }),
  create: (body: SaveAppCommandRequest) => api.post<AppCommandDto>('/api/webapps/commands', body),
  update: (id: number, body: SaveAppCommandRequest) => api.put<AppCommandDto>(`/api/webapps/commands/${id}`, body),
  remove: (id: number) => api.delete(`/api/webapps/commands/${id}`),
};

export const appRunsApi = {
  list: (params: ListAppRunsParams) => api.get<Paged<AppRunDto>>('/api/webapps/runs', { ...params }),
  get: (id: number) => api.get<AppRunDetail>(`/api/webapps/runs/${id}`),
  cancel: (id: number) => api.post(`/api/webapps/runs/${id}/cancel`),
};
