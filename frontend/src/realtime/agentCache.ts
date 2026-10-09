import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '../api/queryKeys';
import type { AgentDetail, AgentListItem, AgentStatusChangedEvent, Paged } from '../api/types';

function patch<T extends AgentDetail | AgentListItem>(agent: T, event: AgentStatusChangedEvent): T {
  if (agent.agentId !== event.agentId) return agent;
  if (agent.status === event.status && agent.lastSeen === event.lastSeen) return agent;
  return { ...agent, status: event.status, lastSeen: event.lastSeen };
}

/** Aplica um evento agentStatusChanged nas listas e detalhes em cache, sem nova requisicao. */
export function applyAgentStatusChange(queryClient: QueryClient, event: AgentStatusChangedEvent): void {
  queryClient.setQueriesData<Paged<AgentListItem>>({ queryKey: queryKeys.agentLists }, (old: Paged<AgentListItem> | undefined) => {
    if (!old) return old;
    const items = old.items.map((agent) => patch(agent, event));
    return items.some((agent, i) => agent !== old.items[i]) ? { ...old, items } : old;
  });
  queryClient.setQueriesData<AgentDetail>({ queryKey: queryKeys.agentDetails }, (old: AgentDetail | undefined) => (old ? patch(old, event) : old));
  void queryClient.invalidateQueries({ queryKey: queryKeys.agentCounts });
}

/** Agente registrado ou excluido: recarregar agentes e contagens dos clientes. */
export async function refreshAgentData(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.agents }),
    queryClient.invalidateQueries({ queryKey: queryKeys.clients }),
  ]);
}
