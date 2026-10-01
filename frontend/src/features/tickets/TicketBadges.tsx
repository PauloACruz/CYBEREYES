import { Badge, Tooltip } from '@mantine/core';
import { IconAlertOctagon, IconMessageCircle } from '@tabler/icons-react';
import type { TicketPriority, TicketStatus, TicketType } from '../../api/types';
import { TICKET_PRIORITY_INFO, TICKET_STATUS_INFO, TICKET_TYPE_LABEL } from './ticketFormat';

export function TicketStatusBadge({ status, size = 'sm' }: { status: TicketStatus; size?: 'sm' | 'md' }) {
  const info = TICKET_STATUS_INFO[status];
  return (
    <Badge color={info.color} variant="light" size={size} leftSection={<info.icon size={12} aria-hidden />}>
      {info.label}
    </Badge>
  );
}

export function TicketPriorityBadge({ priority, size = 'sm' }: { priority: TicketPriority; size?: 'sm' | 'md' }) {
  const info = TICKET_PRIORITY_INFO[priority];
  return (
    <Badge color={info.color} variant={priority === 'critical' ? 'filled' : 'light'} size={size}>
      {info.label}
    </Badge>
  );
}

export function TicketTypeBadge({ type, size = 'sm' }: { type: TicketType; size?: 'sm' | 'md' }) {
  return (
    <Badge color={type === 'incident' ? 'red' : 'gray'} variant="outline" size={size}>
      {TICKET_TYPE_LABEL[type]}
    </Badge>
  );
}

export function SlaBreachedIcon() {
  return (
    <Tooltip label="SLA estourado" withArrow>
      <IconAlertOctagon size={16} color="var(--mantine-color-red-6)" role="img" aria-label="SLA estourado" style={{ flexShrink: 0 }} />
    </Tooltip>
  );
}

export function UnreadIcon() {
  return (
    <Tooltip label="Mensagem do usuário não respondida" withArrow>
      <IconMessageCircle size={16} color="var(--mantine-color-blue-6)" role="img" aria-label="Mensagem não lida" style={{ flexShrink: 0 }} />
    </Tooltip>
  );
}
