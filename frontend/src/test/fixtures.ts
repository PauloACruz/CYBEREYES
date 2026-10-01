import type { AgentListItem, ClientDto } from '../api/types';

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
