import type { AgentDetail, AgentListItem, ClientDto, TicketDetail, TicketListItem, TicketMessageDto } from '../api/types';

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

export function makeTicket(overrides: Partial<TicketListItem> = {}): TicketListItem {
  return {
    id: 101,
    type: 'request',
    title: 'Impressora não imprime',
    status: 'new',
    priority: 'medium',
    queueId: 1,
    queueName: 'Geral',
    agentId: 1,
    hostname: 'PC-RECEPCAO',
    clientName: 'Clínica Central',
    siteName: 'Matriz',
    requesterName: 'maria',
    assignedToId: null,
    assignedToName: null,
    source: 'console',
    createdAt: '2026-10-01T10:00:00Z',
    updatedAt: '2026-10-01T10:30:00Z',
    firstResponseDueAt: '2026-10-01T14:00:00Z',
    resolutionDueAt: '2026-10-02T10:00:00Z',
    slaBreached: false,
    unreadForTechnician: false,
    ...overrides,
  };
}

export function makeTicketDetail(overrides: Partial<TicketDetail> = {}): TicketDetail {
  return {
    ...makeTicket(),
    description: 'A impressora da recepção parou de imprimir.',
    requesterUsername: 'maria',
    requesterEmail: null,
    alertId: null,
    createdByName: 'Maria Silva',
    firstResponseAt: null,
    resolvedAt: null,
    closedAt: null,
    totalMinutes: 0,
    agent: {
      id: 1,
      hostname: 'PC-RECEPCAO',
      status: 'online',
      plat: 'windows',
      operatingSystem: 'Windows 11 Pro 23H2',
      loggedInUsername: 'maria',
      publicIp: '200.10.10.10',
      meshNodeId: null,
    },
    ...overrides,
  };
}

export function makeTicketMessage(overrides: Partial<TicketMessageDto> = {}): TicketMessageDto {
  return {
    id: 1,
    ticketId: 101,
    authorType: 'requester',
    authorName: 'maria',
    body: 'A impressora mostra erro de papel.',
    internal: false,
    createdAt: '2026-10-01T10:05:00Z',
    attachments: [],
    ...overrides,
  };
}
