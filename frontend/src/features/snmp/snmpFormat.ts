import { IconCircleCheck, IconCircleX, IconHelpCircle } from '@tabler/icons-react';
import type {
  SaveSnmpSensorRequest,
  SnmpAuthProtocol,
  SnmpPrivProtocol,
  SnmpSecurityLevel,
  SnmpSensorDto,
  SnmpStatus,
  SnmpTrapSeverity,
} from '../../api/types';
import type { DisplayInfo } from '../monitoring/monitoringFormat';

export const SNMP_STATUS_INFO: Record<SnmpStatus, DisplayInfo> = {
  up: { label: 'Ativo', color: 'teal', icon: IconCircleCheck },
  down: { label: 'Fora do ar', color: 'red', icon: IconCircleX },
  unknown: { label: 'Desconhecido', color: 'gray', icon: IconHelpCircle },
};

export const SNMP_STATUS_OPTIONS = (['up', 'down', 'unknown'] as const).map((value) => ({ value, label: SNMP_STATUS_INFO[value].label }));

export function isSnmpStatus(value: string | null | undefined): value is SnmpStatus {
  return value === 'up' || value === 'down' || value === 'unknown';
}

export const TRAP_SEVERITY_OPTIONS: { value: SnmpTrapSeverity; label: string }[] = [
  { value: 'none', label: 'Não gerar alerta (só log)' },
  { value: 'info', label: 'Informação' },
  { value: 'warning', label: 'Aviso' },
  { value: 'error', label: 'Erro' },
];

export function isTrapSeverity(value: string | null): value is SnmpTrapSeverity {
  return value === 'none' || value === 'info' || value === 'warning' || value === 'error';
}

export const SECURITY_LEVEL_OPTIONS: { value: SnmpSecurityLevel; label: string }[] = [
  { value: 'noAuthNoPriv', label: 'Sem autenticação e sem criptografia (noAuthNoPriv)' },
  { value: 'authNoPriv', label: 'Autenticação sem criptografia (authNoPriv)' },
  { value: 'authPriv', label: 'Autenticação e criptografia (authPriv)' },
];

export function isSecurityLevel(value: string | null): value is SnmpSecurityLevel {
  return value === 'noAuthNoPriv' || value === 'authNoPriv' || value === 'authPriv';
}

export const AUTH_PROTOCOLS: readonly SnmpAuthProtocol[] = ['SHA', 'SHA256', 'SHA512', 'MD5'];
export const PRIV_PROTOCOLS: readonly SnmpPrivProtocol[] = ['AES', 'AES256', 'DES'];

export function isAuthProtocol(value: string | null): value is SnmpAuthProtocol {
  return value !== null && (AUTH_PROTOCOLS as readonly string[]).includes(value);
}

export function isPrivProtocol(value: string | null): value is SnmpPrivProtocol {
  return value !== null && (PRIV_PROTOCOLS as readonly string[]).includes(value);
}

/** Versao minima do agente para ser coletor SNMP. */
export const MIN_COLLECTOR_VERSION = '2.13.0';

/** Compara versoes "x.y.z" (ignora sufixos como "-beta"); versao ilegivel conta como antiga. */
export function versionAtLeast(version: string | null | undefined, minimum: string): boolean {
  const parse = (v: string) => v.trim().replace(/^v/i, '').split(/[.+-]/).slice(0, 3).map((part) => Number.parseInt(part, 10));
  if (!version) return false;
  const a = parse(version);
  const b = parse(minimum);
  if (a.some((n) => Number.isNaN(n))) return false;
  for (let i = 0; i < 3; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

export interface PortStatusInfo {
  label: string;
  color: string;
}

export function adminStatusInfo(status: string | null): PortStatusInfo {
  if (status === 'up') return { label: 'Habilitada', color: 'teal' };
  if (status === 'down') return { label: 'Desabilitada', color: 'gray' };
  return { label: status ?? 'Desconhecido', color: 'gray' };
}

export function operStatusInfo(status: string | null): PortStatusInfo {
  if (status === 'up') return { label: 'Conectada', color: 'teal' };
  if (status === 'down') return { label: 'Desconectada', color: 'red' };
  return { label: status ?? 'Desconhecido', color: 'gray' };
}

export interface SensorTemplate {
  key: string;
  label: string;
  values: SaveSnmpSensorRequest;
}

/** Atalhos de preenchimento (sem MIBs, OIDs numericos). */
export const SENSOR_TEMPLATES: readonly SensorTemplate[] = [
  {
    key: 'toner-level',
    label: 'Impressora: nível do toner preto',
    values: {
      name: 'Toner preto',
      oid: '1.3.6.1.2.1.43.11.1.1.9.1.1',
      unit: null,
      warnAbove: null,
      critAbove: null,
      warnBelow: null,
      critBelow: null,
    },
  },
  {
    key: 'toner-capacity',
    label: 'Impressora: capacidade do toner preto',
    values: {
      name: 'Capacidade do toner preto',
      oid: '1.3.6.1.2.1.43.11.1.1.8.1.1',
      unit: null,
      warnAbove: null,
      critAbove: null,
      warnBelow: null,
      critBelow: null,
    },
  },
  {
    key: 'temperature',
    label: 'Temperatura (genérica, informe o OID)',
    values: { name: 'Temperatura', oid: '', unit: '°C', warnAbove: 50, critAbove: 60, warnBelow: null, critBelow: null },
  },
];

export type SensorState = 'ok' | 'warning' | 'critical' | 'unknown';

export function sensorState(sensor: SnmpSensorDto): SensorState {
  const v = sensor.lastValue;
  if (v === null) return 'unknown';
  if ((sensor.critAbove !== null && v > sensor.critAbove) || (sensor.critBelow !== null && v < sensor.critBelow)) return 'critical';
  if ((sensor.warnAbove !== null && v > sensor.warnAbove) || (sensor.warnBelow !== null && v < sensor.warnBelow)) return 'warning';
  return 'ok';
}

export const SENSOR_STATE_INFO: Record<SensorState, PortStatusInfo> = {
  ok: { label: 'Normal', color: 'teal' },
  warning: { label: 'Aviso', color: 'orange' },
  critical: { label: 'Crítico', color: 'red' },
  unknown: { label: 'Sem leitura', color: 'gray' },
};

const valueFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

export function formatSensorValue(value: number | null, unit: string | null): string {
  if (value === null) return 'Sem leitura';
  return unit ? `${valueFormat.format(value)} ${unit}` : valueFormat.format(value);
}

export function interfaceLabel(iface: { index: number; name: string | null; descr: string | null }): string {
  return iface.name || iface.descr || `Interface ${iface.index}`;
}
