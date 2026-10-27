import { api } from './client';
import type { PeripheralSection, PeripheralTest } from './types';

/** Versão mínima do EYES com a tela de teste no app de bandeja (o app acompanha a versão do agente). */
export const PERIPHERAL_TEST_MIN_VERSION = '3.4.2';

const base = (agentId: number) => `/api/agents/${encodeURIComponent(String(agentId))}/peripheral-tests`;

export const peripheralTestsApi = {
  /** Último teste da máquina; null se nunca houve (204). */
  current: async (agentId: number) => (await api.get<PeripheralTest | undefined>(`${base(agentId)}/current`)) ?? null,
  /** Abre o teste no app do usuário ou, com um teste aberto, troca a seção. */
  start: (agentId: number, section: PeripheralSection) => api.post<PeripheralTest>(base(agentId), { section }),
  end: (agentId: number, testId: number) => api.post<PeripheralTest>(`${base(agentId)}/${encodeURIComponent(String(testId))}/end`),
};
