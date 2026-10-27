import { api } from './client';

export interface KeyCaptureSessionDto {
  id: number;
  agentId: number;
  username: string;
  state: string;
  startedAt: string;
  stoppedAt: string | null;
  entryCount: number;
}

export interface KeyCaptureEntryDto {
  keys: string;
  capturedAt: string;
}

export interface ActiveCaptureDto {
  active: boolean;
  sessionId?: string;
  dbSessionId?: number;
}

export const keyCaptureApi = {
  sessions: (agentId: number, date?: string) =>
    api.get<KeyCaptureSessionDto[]>(`/api/agents/${agentId}/keycapture/sessions`, date ? { date } : undefined),

  entries: (agentId: number, sessionId: number, page?: number) =>
    api.get<KeyCaptureEntryDto[]>(`/api/agents/${agentId}/keycapture/sessions/${sessionId}/entries`, { page, pageSize: 500 }),

  active: (agentId: number) =>
    api.get<ActiveCaptureDto>(`/api/agents/${agentId}/keycapture/active`),
};
