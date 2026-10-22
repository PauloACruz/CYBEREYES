import { api } from './client';
import type { SpeedTestDetail, SpeedTestSummary, StartSpeedTestRequest } from './types';

const base = (agentId: number) => `/api/agents/${encodeURIComponent(String(agentId))}/speedtests`;

/** Versão mínima do EYES com o teste de velocidade. */
export const SPEED_TEST_MIN_VERSION = '3.4.0';

export const speedTestsApi = {
  list: (agentId: number) => api.get<SpeedTestSummary[]>(base(agentId)),
  get: (agentId: number, testId: number) => api.get<SpeedTestDetail>(`${base(agentId)}/${encodeURIComponent(String(testId))}`),
  start: (agentId: number, body: StartSpeedTestRequest) => api.post<SpeedTestSummary>(base(agentId), body),
  /** Download pelo navegador (link comum): o cookie de sessão vai junto. */
  pdfUrl: (agentId: number, testId: number) => `${base(agentId)}/${encodeURIComponent(String(testId))}/pdf`,
};
