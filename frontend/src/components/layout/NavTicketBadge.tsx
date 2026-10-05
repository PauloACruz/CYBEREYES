import { Badge } from '@mantine/core';
import { useTicketSummary } from '../../features/tickets/useTicketSummary';

/** Chamados abertos sem técnico no menu lateral. */
export function NavTicketBadge() {
  const { data } = useTicketSummary();
  const count = data?.unassigned ?? 0;
  if (!count) return null;
  return (
    <Badge
      size="sm"
      color="orange"
      variant="light"
      radius="xs"
      aria-label={`${count} ${count === 1 ? 'chamado sem técnico' : 'chamados sem técnico'}`}
    >
      {count > 99 ? '99+' : count}
    </Badge>
  );
}
