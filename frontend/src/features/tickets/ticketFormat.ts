import {
  IconCircleCheck,
  IconCircleDashed,
  IconClockPause,
  IconLock,
  IconProgress,
  type Icon,
} from '@tabler/icons-react';
import type { TicketPriority, TicketSource, TicketStatus, TicketType } from '../../api/types';

export interface TicketDisplayInfo {
  label: string;
  color: string;
}

export const TICKET_STATUSES: readonly TicketStatus[] = ['new', 'in_progress', 'waiting_user', 'resolved', 'closed'];
export const OPEN_STATUSES: readonly TicketStatus[] = ['new', 'in_progress', 'waiting_user'];

export const TICKET_STATUS_INFO: Record<TicketStatus, TicketDisplayInfo & { icon: Icon }> = {
  new: { label: 'Novo', color: 'blue', icon: IconCircleDashed },
  in_progress: { label: 'Em atendimento', color: 'violet', icon: IconProgress },
  waiting_user: { label: 'Aguardando usuário', color: 'orange', icon: IconClockPause },
  resolved: { label: 'Resolvido', color: 'teal', icon: IconCircleCheck },
  closed: { label: 'Fechado', color: 'gray', icon: IconLock },
};

export const TICKET_PRIORITIES: readonly TicketPriority[] = ['low', 'medium', 'high', 'critical'];

export const TICKET_PRIORITY_INFO: Record<TicketPriority, TicketDisplayInfo> = {
  low: { label: 'Baixa', color: 'gray' },
  medium: { label: 'Média', color: 'blue' },
  high: { label: 'Alta', color: 'orange' },
  critical: { label: 'Crítica', color: 'red' },
};

export const TICKET_TYPES: readonly TicketType[] = ['request', 'incident'];

export const TICKET_TYPE_LABEL: Record<TicketType, string> = {
  request: 'Solicitação',
  incident: 'Incidente',
};

export const TICKET_SOURCE_LABEL: Record<TicketSource, string> = {
  console: 'Console',
  tray: 'App do usuário',
  alert: 'Alerta',
};

export const STATUS_OPTIONS = TICKET_STATUSES.map((value) => ({ value, label: TICKET_STATUS_INFO[value].label }));
export const PRIORITY_OPTIONS = TICKET_PRIORITIES.map((value) => ({ value, label: TICKET_PRIORITY_INFO[value].label }));
export const TYPE_OPTIONS = TICKET_TYPES.map((value) => ({ value, label: TICKET_TYPE_LABEL[value] }));

export function isTicketStatus(value: string | null | undefined): value is TicketStatus {
  return value !== null && value !== undefined && (TICKET_STATUSES as readonly string[]).includes(value);
}

export function isTicketPriority(value: string | null | undefined): value is TicketPriority {
  return value !== null && value !== undefined && (TICKET_PRIORITIES as readonly string[]).includes(value);
}

export function isTicketType(value: string | null | undefined): value is TicketType {
  return value === 'request' || value === 'incident';
}

/** 90 -> "1 h 30 min"; 45 -> "45 min"; 1440 -> "24 h". */
export function formatMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export function isOverdue(due: string | null, now: number = Date.now()): boolean {
  if (!due) return false;
  const time = new Date(due).getTime();
  return !Number.isNaN(time) && time < now;
}
