import type { AgentPlat, ClientDto, GoArch, InstallerAgentType } from '../../api/types';

export const PLAT_OPTIONS: { value: AgentPlat; label: string }[] = [
  { value: 'windows', label: 'Windows' },
  { value: 'linux', label: 'Linux' },
  { value: 'darwin', label: 'macOS' },
];

export const ARCH_OPTIONS: { value: GoArch; label: string }[] = [
  { value: 'amd64', label: '64 bits (amd64)' },
  { value: 'arm64', label: 'ARM 64 bits (arm64)' },
  { value: '386', label: '32 bits (386)' },
  { value: 'arm', label: 'ARM 32 bits (arm)' },
];

export const AGENT_TYPE_LABEL: Record<InstallerAgentType, string> = {
  auto: 'Detectar automaticamente',
  server: 'Servidor',
  workstation: 'Estação',
};

export function agentTypeOptions(plat: AgentPlat | 'all'): { value: InstallerAgentType; label: string }[] {
  const types: InstallerAgentType[] = plat === 'windows' || plat === 'darwin' ? ['server', 'workstation'] : ['auto', 'server', 'workstation'];
  return types.map((value) => ({ value, label: AGENT_TYPE_LABEL[value] }));
}

export function defaultAgentType(plat: AgentPlat): InstallerAgentType {
  return plat === 'linux' ? 'auto' : 'workstation';
}

export function defaultArch(plat: AgentPlat): GoArch {
  return plat === 'darwin' ? 'arm64' : 'amd64';
}

/** Pre-seleciona cliente e site quando so ha uma opcao. */
export function initialSite(clients: ClientDto[]): { clientId: string | null; siteId: string | null } {
  const client = clients.length === 1 ? clients[0] : undefined;
  if (!client) return { clientId: null, siteId: null };
  const site = client.sites.length === 1 ? client.sites[0] : undefined;
  return { clientId: String(client.id), siteId: site ? String(site.id) : null };
}

export function isPlat(value: string): value is AgentPlat {
  return value === 'windows' || value === 'linux' || value === 'darwin';
}

export function isAgentType(value: string | null): value is InstallerAgentType {
  return value === 'auto' || value === 'server' || value === 'workstation';
}

export function isArch(value: string | null): value is GoArch {
  return value === 'amd64' || value === 'arm64' || value === '386' || value === 'arm';
}
