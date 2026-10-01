import type { AgentStatus, ListAgentsParams } from './types';

export const queryKeys = {
  clients: ['clients'] as const,
  deployments: ['deployments'] as const,
  agents: ['agents'] as const,
  agentLists: ['agents', 'list'] as const,
  agentList: (params: ListAgentsParams) => ['agents', 'list', params] as const,
  agentDetails: ['agents', 'detail'] as const,
  agentDetail: (id: number) => ['agents', 'detail', id] as const,
  agentCounts: ['agents', 'count'] as const,
  agentCount: (status: AgentStatus | 'all') => ['agents', 'count', status] as const,
  // Fora de ['agents']: consultas ao vivo nao devem ser refeitas a cada evento agentsChanged.
  agentHistory: (id: number) => ['agent-live', id, 'history'] as const,
  agentProcesses: (id: number) => ['agent-live', id, 'processes'] as const,
  agentServices: (id: number) => ['agent-live', id, 'services'] as const,
  agentEventLog: (id: number, log: string, days: number) => ['agent-live', id, 'eventlog', log, days] as const,
  agentRegistry: (id: number, path: string) => ['agent-live', id, 'registry', path] as const,
  scripts: ['scripts'] as const,
  script: (id: number) => ['scripts', 'detail', id] as const,
  snippets: ['snippets'] as const,
  keystore: ['keystore'] as const,
  urlActions: ['url-actions'] as const,
};
