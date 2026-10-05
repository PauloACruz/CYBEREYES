import { Badge } from '@mantine/core';
import { useTicketSummary } from '../../features/tickets/useTicketSummary';
import { NavCountDot } from './NavCountDot';

/** Chamados abertos sem técnico no menu lateral; no menu recolhido vira um ponto. */
export function NavTicketBadge({ compact = false }: { compact?: boolean }) {
  const { data } = useTicketSummary();
  const count = data?.unassigned ?? 0;
  if (!count) return null;
  const label = `${count} ${count === 1 ? 'chamado sem técnico' : 'chamados sem técnico'}`;
  if (compact) return <NavCountDot color="var(--mantine-color-orange-light-color)" label={label} />;
  return (
    <Badge size="sm" color="orange" variant="light" radius="xs" aria-label={label}>
      {count > 99 ? '99+' : count}
    </Badge>
  );
}
