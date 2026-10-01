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
} as const;

export function agentPath(id: number): string {
  return `${PATHS.agents}/${id}`;
}
