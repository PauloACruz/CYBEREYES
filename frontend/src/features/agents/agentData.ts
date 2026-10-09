// O agente envia discos e servicos como JSON livre; aqui eles sao validados campo a campo.

export interface DiskInfo {
  device: string;
  fstype: string;
  total: string;
  used: string;
  free: string;
  percent: number;
}

export interface ServiceInfo {
  name: string;
  displayName: string;
  status: string;
  startType: string;
  username: string;
  description: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  }
  return '';
}

function percent(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : Number.NaN;
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

export function parseDisks(value: unknown): DiskInfo[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter(isRecord).map((disk) => ({
    device: text(disk, 'device'),
    fstype: text(disk, 'fstype'),
    total: text(disk, 'total'),
    used: text(disk, 'used'),
    free: text(disk, 'free'),
    percent: percent(disk.percent),
  }));
}

export function parseServices(value: unknown): ServiceInfo[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter(isRecord).map((svc) => ({
    name: text(svc, 'name'),
    displayName: text(svc, 'display_name', 'displayName'),
    status: text(svc, 'status'),
    startType: text(svc, 'start_type', 'startType'),
    username: text(svc, 'username'),
    description: text(svc, 'description'),
  }));
}

export type DomainMembership = { kind: 'domain'; domain: string } | { kind: 'workgroup' } | { kind: 'unknown' };

/** Domínio do Windows, lido do Win32_ComputerSystem que o agente envia no WMI (comp_sys). */
export function parseDomainMembership(wmi: unknown): DomainMembership {
  if (!isRecord(wmi)) return { kind: 'unknown' };
  const groups = wmi.comp_sys;
  const first: unknown = Array.isArray(groups) && Array.isArray(groups[0]) ? groups[0][0] : undefined;
  if (!isRecord(first) || typeof first.PartOfDomain !== 'boolean') return { kind: 'unknown' };
  return first.PartOfDomain ? { kind: 'domain', domain: text(first, 'Domain') } : { kind: 'workgroup' };
}
