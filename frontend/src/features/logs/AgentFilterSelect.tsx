import { useState } from 'react';
import { Select, type ComboboxItem } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { agentsApi } from '../../api/agents';
import { queryKeys } from '../../api/queryKeys';

interface AgentFilterSelectProps {
  clientId?: number;
  value: string | null;
  onChange: (value: string | null) => void;
}

/** Filtro de maquina com busca em /api/agents (limitado ao cliente escolhido). */
export function AgentFilterSelect({ clientId, value, onChange }: AgentFilterSelectProps) {
  const [opened, setOpened] = useState(false);
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search.trim(), 300);
  const [chosen, setChosen] = useState<ComboboxItem | null>(null);
  const term = chosen && debounced === chosen.label ? '' : debounced;
  const params = { page: 1, pageSize: 30, clientId, search: term || undefined };
  const agents = useQuery({
    queryKey: queryKeys.agentList(params),
    queryFn: () => agentsApi.list(params),
    enabled: opened,
    placeholderData: keepPreviousData,
  });
  const found: ComboboxItem[] = (agents.data?.items ?? []).map((a) => ({ value: String(a.id), label: a.hostname }));
  const data = chosen && value === chosen.value && !found.some((o) => o.value === chosen.value) ? [chosen, ...found] : found;
  return (
    <Select
      label="Máquina"
      placeholder="Todas as máquinas"
      searchable
      clearable
      filter={({ options }) => options}
      data={data}
      value={value}
      searchValue={search}
      onSearchChange={setSearch}
      onDropdownOpen={() => setOpened(true)}
      onChange={(next, option) => {
        setChosen(next ? option : null);
        onChange(next);
      }}
      nothingFoundMessage={agents.isFetching ? 'Buscando...' : 'Nenhuma máquina encontrada'}
    />
  );
}
