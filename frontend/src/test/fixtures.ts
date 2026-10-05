import type {
  AgentDetail,
  AgentListItem,
  AssetListItem,
  AssetSheet,
  CareCatalog,
  CareRunDto,
  ClientDto,
  PersonListItem,
  TicketDetail,
  TicketListItem,
  TicketMessageDto,
} from '../api/types';

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

export function makeAsset(overrides: Partial<AssetListItem> = {}): AssetListItem {
  return {
    id: 7,
    clientId: 1,
    clientName: 'Clínica Central',
    siteId: 10,
    siteName: 'Matriz',
    agentId: 1,
    type: 'workstation',
    name: 'PC-RECEPCAO',
    manufacturer: 'Dell',
    model: 'OptiPlex 7090',
    serialNumber: 'ABC1234',
    assetTag: 'PAT-0042',
    status: 'active',
    ipAddress: '192.168.1.20',
    responsible: null,
    agentStatus: 'online',
    updatedAt: '2026-10-01T10:00:00Z',
    ...overrides,
  };
}

export function makeAssetSheet(overrides: Partial<AssetSheet> = {}): AssetSheet {
  return {
    asset: {
      ...makeAsset(),
      purchaseDate: '2024-03-10',
      warrantyUntil: '2027-03-10',
      location: 'Recepção, térreo',
      macAddress: 'AA:BB:CC:DD:EE:01',
      notes: null,
      createdAt: '2026-09-01T12:00:00Z',
    },
    responsible: null,
    suggestedPerson: { id: 5, name: 'Maria Souza' },
    history: [],
    hardware: {
      source: 'agent',
      makeModel: 'Dell OptiPlex 7090',
      serialNumber: 'ABC1234',
      cpus: ['Intel Core i5-11500'],
      gpus: ['Intel UHD Graphics 750'],
      ramGb: 16,
      disks: ['Samsung SSD 512 GB'],
      localIps: ['192.168.1.20'],
      operatingSystem: 'Windows 11 Pro 23H2',
      lastLoggedInUser: 'CLINICA\\maria',
      bootTime: null,
    },
    software: { count: 87, updatedAt: '2026-10-01T08:00:00Z' },
    agent: { id: 1, hostname: 'PC-RECEPCAO', status: 'online', plat: 'windows', lastSeen: '2026-10-01T10:00:00Z' },
    network: [],
    credentials: [],
    attachments: [],
    tickets: { open: 0, recent: [] },
    ...overrides,
  };
}

export function makePerson(overrides: Partial<PersonListItem> = {}): PersonListItem {
  return {
    id: 5,
    clientId: 1,
    clientName: 'Clínica Central',
    name: 'Maria Souza',
    email: 'maria@clinica.com.br',
    phone: null,
    department: 'Recepção',
    jobTitle: 'Recepcionista',
    username: 'maria',
    active: true,
    assetCount: 0,
    ...overrides,
  };
}

export function makeCareCatalog(): CareCatalog {
  return {
    version: '2.12.0',
    modules: [
      {
        key: 'maintenance',
        label: 'Manutenção',
        description: 'Limpeza e reparos do sistema.',
        platforms: ['windows'],
        tasks: [
          {
            key: 'temp',
            label: 'Limpar arquivos temporários',
            group: 'Limpeza',
            description: 'Remove arquivos temporários do sistema e dos usuários.',
            default: true,
            platforms: ['windows'],
            selfService: true,
            reboot: false,
            dangerous: false,
            params: [],
          },
          {
            key: 'dism',
            label: 'Reparar imagem (DISM)',
            group: 'Reparo',
            description: 'Executa DISM /RestoreHealth.',
            default: false,
            platforms: ['windows'],
            selfService: false,
            reboot: true,
            dangerous: true,
            params: [{ name: 'source', label: 'Origem da imagem', type: 'string', required: true }],
          },
        ],
      },
    ],
  };
}

export function makeCareRun(overrides: Partial<CareRunDto> = {}): CareRunDto {
  return {
    id: 1,
    runId: 'wc-0123456789abcdef0123456789abcdef',
    agentId: 1,
    hostname: 'PC-RECEPCAO',
    module: 'maintenance',
    tasks: ['temp', 'dism'],
    params: {},
    status: 'running',
    progress: 0,
    startedAt: '2026-10-01T10:00:00Z',
    finishedAt: null,
    requestedBy: 'tecnico',
    source: 'console',
    rebootRequired: false,
    taskStatus: {},
    ...overrides,
  };
}
