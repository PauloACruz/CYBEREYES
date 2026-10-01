import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import { ticketsApi } from '../../api/tickets';
import { PERMISSIONS } from '../../api/types';
import { hasPermission } from '../../auth/permissions';
import { useMe } from '../../auth/useMe';

/** Contadores de chamados: recarregados pelo evento ticketsChanged. */
export function useTicketSummary() {
  const { data: me } = useMe();
  return useQuery({
    queryKey: queryKeys.ticketSummary,
    queryFn: ticketsApi.summary,
    enabled: hasPermission(me, PERMISSIONS.ticketsView),
    staleTime: 60_000,
  });
}
