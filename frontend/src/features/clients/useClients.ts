import { useQuery } from '@tanstack/react-query';
import { clientsApi } from '../../api/clients';
import { queryKeys } from '../../api/queryKeys';
import type { ClientDto } from '../../api/types';

export function useClients(enabled = true) {
  return useQuery({ queryKey: queryKeys.clients, queryFn: clientsApi.list, staleTime: 30_000, enabled });
}

export interface SelectGroup {
  group: string;
  items: { value: string; label: string }[];
}

/** Sites agrupados por cliente, no formato de grupos do Select do Mantine. */
export function siteSelectGroups(clients: ClientDto[] | undefined): SelectGroup[] {
  return (clients ?? []).map((client) => ({
    group: client.name,
    items: client.sites.map((site) => ({ value: String(site.id), label: `${client.name} / ${site.name}` })),
  }));
}
