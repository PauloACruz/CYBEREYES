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
};
