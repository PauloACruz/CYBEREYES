import type { AlertDto, AlertStatusFilter, AlertType } from '../../api/types';

export const ALERT_TYPE_LABEL: Record<AlertType, string> = {
  availability: 'Disponibilidade',
  check: 'Check',
  task: 'Tarefa',
  log: 'Log',
  snmp_device: 'Dispositivo SNMP',
  snmp_interface: 'Interface SNMP',
  snmp_sensor: 'Sensor SNMP',
  snmp_trap: 'Trap SNMP',
};

export const STATUS_FILTER_OPTIONS: { value: AlertStatusFilter; label: string }[] = [
  { value: 'active', label: 'Ativos' },
  { value: 'resolved', label: 'Resolvidos' },
  { value: 'all', label: 'Todos' },
];

export function isStatusFilter(value: string | null): value is AlertStatusFilter {
  return value === 'active' || value === 'resolved' || value === 'all';
}

export function isSnoozed(alert: AlertDto, now: number = Date.now()): boolean {
  return !alert.resolved && alert.snoozedUntil !== null && new Date(alert.snoozedUntil).getTime() > now;
}
