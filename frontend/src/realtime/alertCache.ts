import { notifications } from '@mantine/notifications';
import type { QueryClient } from '@tanstack/react-query';
import { alertsApi } from '../api/alerts';
import { queryKeys } from '../api/queryKeys';
import { PERMISSIONS, type AlertsChangedEvent, type MeDto } from '../api/types';
import { hasPermission } from '../auth/permissions';
import { ME_QUERY_KEY } from '../auth/useMe';

/**
 * Aplica um evento alertsChanged: grava o novo total no contador do menu e recarrega as listas de alertas.
 * Devolve true quando o total aumentou em relacao ao valor conhecido (chegou alerta novo).
 */
export function applyAlertsChanged(queryClient: QueryClient, event: { activeCount: number }): boolean {
  const previous = queryClient.getQueryData<number>(queryKeys.activeAlertCount);
  queryClient.setQueryData<number>(queryKeys.activeAlertCount, event.activeCount);
  void queryClient.invalidateQueries({ queryKey: queryKeys.alerts });
  return previous !== undefined && event.activeCount > previous;
}

export function handleAlertsChanged(queryClient: QueryClient, event: AlertsChangedEvent): void {
  const me = queryClient.getQueryData<MeDto>(ME_QUERY_KEY);
  if (!hasPermission(me, PERMISSIONS.alertsView)) return;
  if (event.activeCount === null) {
    // Quem vê só alguns clientes recebe o aviso sem o total geral: conta os alertas do próprio escopo.
    alertsApi
      .list({ status: 'active', page: 1, pageSize: 1 })
      .then((page) => notifyIfNew(queryClient, page.total))
      .catch(() => undefined);
    return;
  }
  notifyIfNew(queryClient, event.activeCount);
}

function notifyIfNew(queryClient: QueryClient, activeCount: number): void {
  if (!applyAlertsChanged(queryClient, { activeCount })) return;
  notifications.show({
    id: 'novo-alerta',
    color: 'red',
    title: 'Novo alerta',
    message: activeCount === 1 ? 'Há 1 alerta ativo.' : `Há ${activeCount} alertas ativos.`,
  });
}
