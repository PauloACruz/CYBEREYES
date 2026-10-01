import {
  IconAlertTriangle,
  IconCircleCheck,
  IconCircleX,
  IconClockHour4,
  IconInfoCircle,
  type Icon,
} from '@tabler/icons-react';
import type { CheckStatus, Severity } from '../../api/types';

export interface DisplayInfo {
  label: string;
  color: string;
  icon: Icon;
}

export const SEVERITIES: readonly Severity[] = ['info', 'warning', 'error'];

export const SEVERITY_INFO: Record<Severity, DisplayInfo> = {
  info: { label: 'Informação', color: 'blue', icon: IconInfoCircle },
  warning: { label: 'Aviso', color: 'orange', icon: IconAlertTriangle },
  error: { label: 'Erro', color: 'red', icon: IconCircleX },
};

export const SEVERITY_OPTIONS = SEVERITIES.map((value) => ({ value, label: SEVERITY_INFO[value].label }));

export function isSeverity(value: string | null | undefined): value is Severity {
  return value === 'info' || value === 'warning' || value === 'error';
}

export const CHECK_STATUS_INFO: Record<CheckStatus, DisplayInfo> = {
  passing: { label: 'OK', color: 'teal', icon: IconCircleCheck },
  failing: { label: 'Falha', color: 'red', icon: IconCircleX },
  pending: { label: 'Pendente', color: 'gray', icon: IconClockHour4 },
};

export function isCheckStatus(value: string): value is CheckStatus {
  return value === 'passing' || value === 'failing' || value === 'pending';
}

/** Domingo = 0, como no contrato. */
export const WEEKDAYS: readonly { value: number; short: string; long: string }[] = [
  { value: 0, short: 'Dom', long: 'domingo' },
  { value: 1, short: 'Seg', long: 'segunda-feira' },
  { value: 2, short: 'Ter', long: 'terça-feira' },
  { value: 3, short: 'Qua', long: 'quarta-feira' },
  { value: 4, short: 'Qui', long: 'quinta-feira' },
  { value: 5, short: 'Sex', long: 'sexta-feira' },
  { value: 6, short: 'Sáb', long: 'sábado' },
];
