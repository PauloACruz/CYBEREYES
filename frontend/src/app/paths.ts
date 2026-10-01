export const PATHS = {
  login: '/login',
  loginTwoFactor: '/login/2fa',
  twoFactorSetup: '/2fa/setup',
  dashboard: '/',
  agents: '/agentes',
  clients: '/clientes',
  deployments: '/implantacoes',
  users: '/usuarios',
  roles: '/papeis',
  apiKeys: '/chaves-api',
  audit: '/auditoria',
  scripts: '/scripts',
  settings: '/configuracoes',
  alerts: '/alertas',
  alertTemplates: '/alertas/templates',
  policies: '/politicas',
  policyAssignments: '/politicas/atribuicoes',
  tickets: '/chamados',
  inventory: '/inventario',
  people: '/inventario/pessoas',
  docs: '/documentacao',
  newDocPage: '/documentacao/paginas/nova',
  logs: '/logs',
  snmp: '/snmp',
  reports: '/relatorios',
} as const;

export function agentPath(id: number): string {
  return `${PATHS.agents}/${id}`;
}

export function policyPath(id: number): string {
  return `${PATHS.policies}/${id}`;
}

export function ticketPath(id: number): string {
  return `${PATHS.tickets}/${id}`;
}

export function assetPath(id: number): string {
  return `${PATHS.inventory}/${id}`;
}

export function personPath(id: number): string {
  return `${PATHS.people}/${id}`;
}

export function networkPath(id: number): string {
  return `${PATHS.docs}/redes/${id}`;
}

export function diagramPath(id: number): string {
  return `${PATHS.docs}/diagramas/${id}`;
}

export function docPagePath(id: number): string {
  return `${PATHS.docs}/paginas/${id}`;
}

/** Aba da tela de documentacao (?aba=). */
export function docsTabPath(tab: 'redes' | 'diagramas' | 'credenciais' | 'paginas'): string {
  return tab === 'redes' ? PATHS.docs : `${PATHS.docs}?aba=${tab}`;
}

export function snmpDevicePath(id: number): string {
  return `${PATHS.snmp}/${id}`;
}
