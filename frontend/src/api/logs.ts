import { api } from './client';
import type {
  ListLogsParams,
  LogAlertRuleDto,
  LogPage,
  LogSettingsDto,
  LogSummaryDto,
  LogSummaryParams,
  SaveLogAlertRuleRequest,
} from './types';

export const logsApi = {
  list: (params: ListLogsParams) => api.get<LogPage>('/api/logs', { ...params }),
  summary: (params: LogSummaryParams) => api.get<LogSummaryDto>('/api/logs/summary', { ...params }),
  settings: () => api.get<LogSettingsDto>('/api/logs/settings'),
  saveSettings: (body: LogSettingsDto) => api.put<LogSettingsDto>('/api/logs/settings', body),
};

export const logAlertRulesApi = {
  list: () => api.get<LogAlertRuleDto[]>('/api/log-alert-rules'),
  create: (body: SaveLogAlertRuleRequest) => api.post<LogAlertRuleDto>('/api/log-alert-rules', body),
  update: (id: number, body: SaveLogAlertRuleRequest) => api.put<LogAlertRuleDto>(`/api/log-alert-rules/${id}`, body),
  remove: (id: number) => api.delete(`/api/log-alert-rules/${id}`),
};
