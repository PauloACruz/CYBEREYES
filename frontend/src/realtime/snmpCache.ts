import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '../api/queryKeys';
import type { SnmpDeviceChangedEvent, SnmpDeviceDetail } from '../api/types';

/** Evento snmpDeviceChanged: aplica o novo estado no detalhe em cache e recarrega as listas. */
export function applySnmpDeviceChanged(queryClient: QueryClient, event: SnmpDeviceChangedEvent): void {
  queryClient.setQueryData<SnmpDeviceDetail>(queryKeys.snmpDevice(event.id), (old) => (old ? { ...old, ...event } : old));
  void queryClient.invalidateQueries({ queryKey: queryKeys.snmpDeviceLists });
  void queryClient.invalidateQueries({ queryKey: queryKeys.snmpDevice(event.id), exact: true });
}
