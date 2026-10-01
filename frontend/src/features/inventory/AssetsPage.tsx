import { useState } from 'react';
import { Anchor, Button, Group, Pagination, Paper, Select, Table, Text, TextInput } from '@mantine/core';
import { useDebouncedCallback, useDisclosure } from '@mantine/hooks';
import { IconPlus, IconSearch } from '@tabler/icons-react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { assetsApi } from '../../api/inventory';
import { queryKeys } from '../../api/queryKeys';
import { PERMISSIONS, type AssetListItem, type ListAssetsParams } from '../../api/types';
import { assetPath, personPath } from '../../app/paths';
import { hasPermission } from '../../auth/permissions';
import { useMe } from '../../auth/useMe';
import { PageHeader } from '../../components/PageHeader';
import { EmptyRow, LoadError, LoadingRows } from '../../components/TableStates';
import { totalPages } from '../../lib/format';
import { AgentStatusBadge } from '../agents/agentDisplay';
import { useClients } from '../clients/useClients';
import { AssetFormModal } from './AssetFormModal';
import { AssetStatusBadge, AssetTypeIcon } from './AssetBadges';
import { InventoryTabs } from './InventoryTabs';
import { ASSET_STATUS_OPTIONS, ASSET_TYPE_OPTIONS, isAssetStatus, isAssetType, makeModel, toId } from './inventoryFormat';

const PAGE_SIZE = 50;
const COLUMNS = 9;

export function AssetsPage() {
  const { data: me } = useMe();
  const canManage = hasPermission(me, PERMISSIONS.inventoryManage);
  const [searchParams, setSearchParams] = useSearchParams();
  const [createOpened, createModal] = useDisclosure(false);
  const clients = useClients();

  const typeParam = searchParams.get('tipo');
  const statusParam = searchParams.get('status');
  const currentSearch = searchParams.get('busca') ?? '';
  const [search, setSearch] = useState(currentSearch);

  const params: ListAssetsParams = {
    clientId: toId(searchParams.get('cliente')),
    siteId: toId(searchParams.get('site')),
    type: isAssetType(typeParam) ? typeParam : undefined,
    status: isAssetStatus(statusParam) ? statusParam : undefined,
    search: currentSearch || undefined,
    page: toId(searchParams.get('pagina')) ?? 1,
    pageSize: PAGE_SIZE,
  };

  const updateParams = (changes: Record<string, string | undefined>) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        if (!('pagina' in changes)) next.delete('pagina');
        return next;
      },
      { replace: true },
    );
  };
  const applySearch = useDebouncedCallback((value: string) => updateParams({ busca: value.trim() || undefined }), 300);

  const assets = useQuery({
    queryKey: queryKeys.assetList(params),
    queryFn: () => assetsApi.list(params),
    placeholderData: keepPreviousData,
  });

  const selectedClient = clients.data?.find((c) => c.id === params.clientId);
  const hasFilters = params.clientId !== undefined || params.type !== undefined || params.status !== undefined || params.search !== undefined;

  return (
    <>
      <PageHeader
        title="Inventário"
        description="Equipamentos dos clientes, responsáveis e fichas técnicas."
        actions={
          canManage && (
            <Button leftSection={<IconPlus size={16} />} onClick={createModal.open}>
              Novo ativo
            </Button>
          )
        }
      />
      <InventoryTabs active="ativos" />
      <Group mb="md" gap="sm" align="flex-end" wrap="wrap">
        <TextInput
          placeholder="Nome, patrimônio, série, modelo ou IP"
          aria-label="Buscar ativos"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => {
            setSearch(e.currentTarget.value);
            applySearch(e.currentTarget.value);
          }}
          w={300}
        />
        <Select
          aria-label="Filtrar por cliente"
          placeholder="Todos os clientes"
          clearable
          searchable
          data={(clients.data ?? []).map((c) => ({ value: String(c.id), label: c.name }))}
          value={params.clientId ? String(params.clientId) : null}
          onChange={(v) => updateParams({ cliente: v ?? undefined, site: undefined })}
          w={200}
        />
        <Select
          aria-label="Filtrar por site"
          placeholder="Todos os sites"
          clearable
          disabled={!selectedClient}
          data={(selectedClient?.sites ?? []).map((s) => ({ value: String(s.id), label: s.name }))}
          value={params.siteId ? String(params.siteId) : null}
          onChange={(v) => updateParams({ site: v ?? undefined })}
          w={170}
        />
        <Select
          aria-label="Filtrar por tipo"
          placeholder="Todos os tipos"
          clearable
          data={ASSET_TYPE_OPTIONS}
          value={params.type ?? null}
          onChange={(v) => updateParams({ tipo: v ?? undefined })}
          w={170}
        />
        <Select
          aria-label="Filtrar por status"
          placeholder="Todos os status"
          clearable
          data={ASSET_STATUS_OPTIONS}
          value={params.status ?? null}
          onChange={(v) => updateParams({ status: v ?? undefined })}
          w={160}
        />
      </Group>

      {assets.isError && <LoadError error={assets.error} onRetry={() => void assets.refetch()} />}
      <Paper withBorder style={{ opacity: assets.isPlaceholderData ? 0.6 : 1 }}>
        <AssetsTable
          assets={assets.data?.items ?? []}
          loading={assets.isPending}
          emptyMessage={hasFilters ? 'Nenhum ativo encontrado com esses filtros.' : 'Nenhum ativo cadastrado.'}
        />
      </Paper>
      {assets.data && (
        <Group justify="space-between" mt="md">
          <Text size="sm" c="dimmed">
            {assets.data.total} {assets.data.total === 1 ? 'ativo' : 'ativos'}
          </Text>
          <Pagination
            total={totalPages(assets.data.total, PAGE_SIZE)}
            value={params.page}
            onChange={(p) => updateParams({ pagina: p > 1 ? String(p) : undefined })}
            size="sm"
          />
        </Group>
      )}

      {canManage && <AssetFormModal opened={createOpened} onClose={createModal.close} />}
    </>
  );
}

function Missing() {
  return (
    <Text size="sm" c="dimmed">
      Não informado
    </Text>
  );
}

function AssetsTable({ assets, loading, emptyMessage }: { assets: AssetListItem[]; loading: boolean; emptyMessage: string }) {
  return (
    <Table.ScrollContainer minWidth={1150}>
      <Table verticalSpacing="xs" highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Nome</Table.Th>
            <Table.Th w={60}>Tipo</Table.Th>
            <Table.Th w={190}>Fabricante / modelo</Table.Th>
            <Table.Th w={110}>Patrimônio</Table.Th>
            <Table.Th w={140}>Série</Table.Th>
            <Table.Th w={130}>IP</Table.Th>
            <Table.Th w={160}>Responsável</Table.Th>
            <Table.Th w={110}>Status</Table.Th>
            <Table.Th w={110}>Agente</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {loading && <LoadingRows columns={COLUMNS} />}
          {!loading && assets.length === 0 && <EmptyRow columns={COLUMNS} message={emptyMessage} />}
          {assets.map((asset) => (
            <Table.Tr key={asset.id}>
              <Table.Td>
                <Anchor component={Link} to={assetPath(asset.id)} size="sm" fw={600}>
                  {asset.name}
                </Anchor>
                <Text size="xs" c="dimmed">
                  {asset.clientName}
                  {asset.siteName ? ` / ${asset.siteName}` : ''}
                </Text>
              </Table.Td>
              <Table.Td>
                <AssetTypeIcon type={asset.type} />
              </Table.Td>
              <Table.Td>{makeModel(asset.manufacturer, asset.model) ? <Text size="sm">{makeModel(asset.manufacturer, asset.model)}</Text> : <Missing />}</Table.Td>
              <Table.Td>{asset.assetTag ? <Text size="sm">{asset.assetTag}</Text> : <Missing />}</Table.Td>
              <Table.Td>
                {asset.serialNumber ? (
                  <Text size="sm" ff="monospace">
                    {asset.serialNumber}
                  </Text>
                ) : (
                  <Missing />
                )}
              </Table.Td>
              <Table.Td>
                {asset.ipAddress ? (
                  <Text size="sm" ff="monospace">
                    {asset.ipAddress}
                  </Text>
                ) : (
                  <Missing />
                )}
              </Table.Td>
              <Table.Td>
                {asset.responsible ? (
                  <Anchor component={Link} to={personPath(asset.responsible.id)} size="sm">
                    {asset.responsible.name}
                  </Anchor>
                ) : (
                  <Text size="sm" c="dimmed">
                    Sem responsável
                  </Text>
                )}
              </Table.Td>
              <Table.Td>
                <AssetStatusBadge status={asset.status} />
              </Table.Td>
              <Table.Td>{asset.agentStatus ? <AgentStatusBadge status={asset.agentStatus} /> : null}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
