import {
  IconAccessPoint,
  IconBatteryCharging,
  IconBox,
  IconDeviceDesktop,
  IconDeviceLaptop,
  IconDeviceTv,
  IconPhone,
  IconPrinter,
  IconRouter,
  IconServer,
  IconTopologyStar3,
  IconWall,
  type Icon,
} from '@tabler/icons-react';
import type { AssetStatus, AssetType, IpKind } from '../../api/types';

export const ASSET_TYPES: readonly AssetType[] = [
  'workstation',
  'server',
  'laptop',
  'printer',
  'switch',
  'router',
  'firewall',
  'access_point',
  'phone',
  'monitor',
  'ups',
  'other',
];

export const ASSET_TYPE_INFO: Record<AssetType, { label: string; icon: Icon }> = {
  workstation: { label: 'Estação', icon: IconDeviceDesktop },
  server: { label: 'Servidor', icon: IconServer },
  laptop: { label: 'Notebook', icon: IconDeviceLaptop },
  printer: { label: 'Impressora', icon: IconPrinter },
  switch: { label: 'Switch', icon: IconTopologyStar3 },
  router: { label: 'Roteador', icon: IconRouter },
  firewall: { label: 'Firewall', icon: IconWall },
  access_point: { label: 'Access point', icon: IconAccessPoint },
  phone: { label: 'Telefone', icon: IconPhone },
  monitor: { label: 'Monitor', icon: IconDeviceTv },
  ups: { label: 'Nobreak', icon: IconBatteryCharging },
  other: { label: 'Outro', icon: IconBox },
};

export const ASSET_STATUSES: readonly AssetStatus[] = ['active', 'stock', 'maintenance', 'retired'];

export const ASSET_STATUS_INFO: Record<AssetStatus, { label: string; color: string }> = {
  active: { label: 'Em uso', color: 'teal' },
  stock: { label: 'Estoque', color: 'blue' },
  maintenance: { label: 'Manutenção', color: 'orange' },
  retired: { label: 'Baixado', color: 'gray' },
};

export const IP_KINDS: readonly IpKind[] = ['static', 'reserved', 'dhcp'];

export const IP_KIND_INFO: Record<IpKind, { label: string; color: string }> = {
  static: { label: 'Fixo', color: 'blue' },
  reserved: { label: 'Reservado', color: 'violet' },
  dhcp: { label: 'DHCP', color: 'gray' },
};

export const ASSET_TYPE_OPTIONS = ASSET_TYPES.map((value) => ({ value, label: ASSET_TYPE_INFO[value].label }));
export const ASSET_STATUS_OPTIONS = ASSET_STATUSES.map((value) => ({ value, label: ASSET_STATUS_INFO[value].label }));
export const IP_KIND_OPTIONS = IP_KINDS.map((value) => ({ value, label: IP_KIND_INFO[value].label }));

export function isAssetType(value: string | null | undefined): value is AssetType {
  return value !== null && value !== undefined && (ASSET_TYPES as readonly string[]).includes(value);
}

export function isAssetStatus(value: string | null | undefined): value is AssetStatus {
  return value !== null && value !== undefined && (ASSET_STATUSES as readonly string[]).includes(value);
}

export function isIpKind(value: string | null | undefined): value is IpKind {
  return value !== null && value !== undefined && (IP_KINDS as readonly string[]).includes(value);
}

/** Id positivo lido da URL ou de um Select. */
export function toId(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

/** Texto aparado ou undefined (campos opcionais do contrato). */
export function optional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function makeModel(manufacturer: string | null, model: string | null): string {
  return [manufacturer, model].filter(Boolean).join(' ');
}
