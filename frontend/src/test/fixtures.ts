import type { AgentDetail, AgentListItem, ClientDto } from '../api/types';

export function makeAgent(overrides: Partial<AgentListItem> = {}): AgentListItem {
  return {
    id: 1,
    agentId: 'agent-1',
    hostname: 'PC-RECEPCAO',
    clientId: 1,
    clientName: 'Clínica Central',
    siteId: 10,
    siteName: 'Matriz',
    monitoringType: 'workstation',
    plat: 'windows',
    operatingSystem: 'Windows 11 Pro 23H2',
    status: 'online',
    lastSeen: new Date().toISOString(),
    version: '2.9.1',
    loggedInUsername: 'maria',
    lastLoggedInUser: 'maria',
    publicIp: '200.10.10.10',
    needsReboot: false,
    description: null,
    ...overrides,
  };
}

export const CLIENTS: ClientDto[] = [
  { id: 1, name: 'Clínica Central', agentCount: 2, sites: [{ id: 10, clientId: 1, name: 'Matriz', agentCount: 2 }] },
];

export function makeAgentDetail(overrides: Partial<AgentDetail> = {}): AgentDetail {
  return {
    ...makeAgent(),
    goArch: 'amd64',
    totalRam: 16,
    bootTime: null,
    meshNodeId: null,
    disks: [],
    services: [],
    wmi: null,
    checkInterval: 60,
    offlineTime: 4,
    overdueTime: 30,
    createdAt: '2026-09-01T12:00:00Z',
    ...overrides,
  };
}
