import { notifications } from '@mantine/notifications';
import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '../api/queryKeys';
import { PERMISSIONS, type AlertsChangedEvent, type MeDto } from '../api/types';
import { hasPermission } from '../auth/permissions';
import { ME_QUERY_KEY } from '../auth/useMe';

/**
 * Aplica um evento alertsChanged: grava o novo total no contador do menu e recarrega as listas de alertas.
 * Devolve true quando o total aumentou em relacao ao valor conhecido (chegou alerta novo).
 */
export function applyAlertsChanged(queryClient: QueryClient, event: AlertsChangedEvent): boolean {
  const previous = queryClient.getQueryData<number>(queryKeys.activeAlertCount);
  queryClient.setQueryData<number>(queryKeys.activeAlertCount, event.activeCount);
  void queryClient.invalidateQueries({ queryKey: queryKeys.alerts });
  return previous !== undefined && event.activeCount > previous;
}

export function handleAlertsChanged(queryClient: QueryClient, event: AlertsChangedEvent): void {
  const me = queryClient.getQueryData<MeDto>(ME_QUERY_KEY);
  if (!hasPermission(me, PERMISSIONS.alertsView)) return;
  if (!applyAlertsChanged(queryClient, event)) return;
  notifications.show({
    id: 'novo-alerta',
    color: 'red',
    title: 'Novo alerta',
    message: event.activeCount === 1 ? 'Há 1 alerta ativo.' : `Há ${event.activeCount} alertas ativos.`,
  });
}
