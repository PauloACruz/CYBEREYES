import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { queryKeys } from '../api/queryKeys';
import type { AgentDetail, AgentListItem, Paged } from '../api/types';
import { makeAgent } from '../test/fixtures';
import { applyAgentStatusChange } from './agentCache';

const params = { page: 1, pageSize: 50 };

function detailOf(agent: AgentListItem): AgentDetail {
  return {
    ...agent,
    goArch: 'amd64',
    totalRam: 16,
    bootTime: null,
    disks: null,
    services: null,
    wmi: null,
    checkInterval: 120,
    offlineTime: 4,
    overdueTime: 30,
    createdAt: '2026-09-01T00:00:00Z',
  };
}

describe('applyAgentStatusChange', () => {
  it('atualiza status e lastSeen na lista e no detalhe, sem tocar nos outros agentes', () => {
    const queryClient = new QueryClient();
    const target = makeAgent({ id: 1, agentId: 'abc', status: 'online', lastSeen: '2026-10-01T10:00:00Z' });
    const other = makeAgent({ id: 2, agentId: 'xyz', status: 'online' });
    queryClient.setQueryData<Paged<AgentListItem>>(queryKeys.agentList(params), { items: [target, other], total: 2, page: 1, pageSize: 50 });
    queryClient.setQueryData<AgentDetail>(queryKeys.agentDetail(1), detailOf(target));
    queryClient.setQueryData<AgentDetail>(queryKeys.agentDetail(2), detailOf(other));
    const otherDetailBefore = queryClient.getQueryData<AgentDetail>(queryKeys.agentDetail(2));

    applyAgentStatusChange(queryClient, { agentId: 'abc', status: 'offline', lastSeen: '2026-10-01T10:05:00Z' });

    const list = queryClient.getQueryData<Paged<AgentListItem>>(queryKeys.agentList(params));
    expect(list?.items[0]).toMatchObject({ agentId: 'abc', status: 'offline', lastSeen: '2026-10-01T10:05:00Z' });
    expect(list?.items[1]).toBe(other);
    expect(queryClient.getQueryData<AgentDetail>(queryKeys.agentDetail(1))).toMatchObject({
      status: 'offline',
      lastSeen: '2026-10-01T10:05:00Z',
      totalRam: 16,
    });
    expect(queryClient.getQueryData<AgentDetail>(queryKeys.agentDetail(2))).toBe(otherDetailBefore);
  });

  it('mantem a mesma referencia quando nenhum agente em cache corresponde', () => {
    const queryClient = new QueryClient();
    const page: Paged<AgentListItem> = { items: [makeAgent({ agentId: 'abc' })], total: 1, page: 1, pageSize: 50 };
    queryClient.setQueryData(queryKeys.agentList(params), page);

    applyAgentStatusChange(queryClient, { agentId: 'outro', status: 'overdue', lastSeen: null });

    expect(queryClient.getQueryData(queryKeys.agentList(params))).toBe(page);
  });
});
