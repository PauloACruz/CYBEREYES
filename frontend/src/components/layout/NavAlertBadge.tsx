import { Badge } from '@mantine/core';
import { useActiveAlertCount } from '../../features/alerts/useActiveAlertCount';
import { NavCountDot } from './NavCountDot';

/** Contador de alertas ativos no menu lateral; no menu recolhido vira um ponto. */
export function NavAlertBadge({ compact = false }: { compact?: boolean }) {
  const { data: count } = useActiveAlertCount();
  if (!count) return null;
  const label = `${count} ${count === 1 ? 'alerta ativo' : 'alertas ativos'}`;
  if (compact) return <NavCountDot color="var(--mantine-color-red-light-color)" label={label} />;
  return (
    <Badge size="sm" color="red" variant="light" radius="xs" aria-label={label}>
      {count > 99 ? '99+' : count}
    </Badge>
  );
}
