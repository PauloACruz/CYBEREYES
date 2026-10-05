import { Badge } from '@mantine/core';
import { useActiveAlertCount } from '../../features/alerts/useActiveAlertCount';

/** Contador de alertas ativos no menu lateral. */
export function NavAlertBadge() {
  const { data: count } = useActiveAlertCount();
  if (!count) return null;
  return (
    <Badge size="sm" color="red" variant="light" radius="xs" aria-label={`${count} ${count === 1 ? 'alerta ativo' : 'alertas ativos'}`}>
      {count > 99 ? '99+' : count}
    </Badge>
  );
}
