import { useState } from 'react';
import { Select, type ComboboxItem } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { assetsApi } from '../../api/inventory';
import { queryKeys } from '../../api/queryKeys';
import type { AssetListItem } from '../../api/types';

const SEARCH_SIZE = 20;

interface AssetSearchSelectProps {
  label: string;
  description?: string;
  clientId?: number;
  value: string | null;
  /** Rotulo do valor atual quando ele nao esta no resultado da busca (edicao). */
  currentLabel?: string | null;
  onChange: (value: string | null, asset: AssetListItem | undefined) => void;
  disabled?: boolean;
}

/** Select com busca em /api/assets, limitado ao cliente quando informado. */
export function AssetSearchSelect({ label, description, clientId, value, currentLabel, onChange, disabled }: AssetSearchSelectProps) {
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search.trim(), 300);
  const [known, setKnown] = useState<Record<string, string>>(() => (value && currentLabel ? { [value]: currentLabel } : {}));
  const params = { page: 1, pageSize: SEARCH_SIZE, clientId, search: debounced || undefined };
  const assets = useQuery({
    queryKey: queryKeys.assetList(params),
    queryFn: () => assetsApi.list(params),
    placeholderData: keepPreviousData,
    enabled: !disabled,
  });

  const options: ComboboxItem[] = Object.entries(known).map(([id, name]) => ({ value: id, label: name }));
  for (const asset of assets.data?.items ?? []) {
    if (!known[String(asset.id)]) options.push({ value: String(asset.id), label: asset.assetTag ? `${asset.name} (${asset.assetTag})` : asset.name });
  }

  return (
    <Select
      label={label}
      description={description}
      placeholder="Buscar por nome, patrimônio, série ou IP"
      searchable
      clearable
      disabled={disabled}
      filter={({ options: items }) => items}
      searchValue={search}
      onSearchChange={setSearch}
      nothingFoundMessage={assets.isFetching ? 'Buscando...' : 'Nenhum ativo encontrado'}
      data={options}
      value={value}
      onChange={(next) => {
        const found = assets.data?.items.find((a) => String(a.id) === next);
        if (next && found) setKnown({ [next]: found.name });
        onChange(next, found);
      }}
    />
  );
}
