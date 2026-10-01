import { useQuery } from '@tanstack/react-query';
import { alertsApi } from '../../api/alerts';
import { queryKeys } from '../../api/queryKeys';
import { PERMISSIONS } from '../../api/types';
import { hasPermission } from '../../auth/permissions';
import { useMe } from '../../auth/useMe';

/** Total de alertas ativos: carga inicial pela API, depois atualizado pelo evento alertsChanged. */
export function useActiveAlertCount() {
  const { data: me } = useMe();
  return useQuery({
    queryKey: queryKeys.activeAlertCount,
    queryFn: async () => (await alertsApi.list({ status: 'active', page: 1, pageSize: 1 })).total,
    enabled: hasPermission(me, PERMISSIONS.alertsView),
    staleTime: Number.POSITIVE_INFINITY,
  });
}
