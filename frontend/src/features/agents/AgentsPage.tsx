import { useState } from 'react';
import { Anchor, Badge, Button, Group, Pagination, Paper, Select, Table, Text, TextInput, Tooltip } from '@mantine/core';
import { useDebouncedCallback, useDisclosure } from '@mantine/hooks';
import { IconCloudDownload, IconDownload, IconRefreshAlert, IconSearch } from '@tabler/icons-react';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { agentActionsApi } from '../../api/agentActions';
import { agentsApi } from '../../api/agents';
import { queryKeys } from '../../api/queryKeys';
import { PERMISSIONS, type AgentSortColumn, type AgentStatus, type ListAgentsParams } from '../../api/types';
import { agentPath } from '../../app/paths';
import { hasPermission } from '../../auth/permissions';
import { useMe } from '../../auth/useMe';
import { PageHeader } from '../../components/PageHeader';
import { SortableTh, type SortState } from '../../components/SortableTh';
import { EmptyRow, LoadError, LoadingRows } from '../../components/TableStates';
import { confirmAction, notifySuccess } from '../../lib/feedback';
import { totalPages } from '../../lib/format';
import { useClients } from '../clients/useClients';
import { AgentStatusBadge, OperatingSystem, RelativeTime } from './agentDisplay';
import { loggedUser, MONITORING_TYPE_LABEL, STATUS_INFO, STATUS_OPTIONS } from './agentFormat';
import { InstallAgentModal } from './InstallAgentModal';

const PAGE_SIZE = 50;
const COLUMNS = 9;

const SORT_COLUMNS: readonly AgentSortColumn[] = ['status', 'hostname', 'client', 'type', 'os', 'user', 'version', 'lastSeen', 'reboot'];

function isSortColumn(value: string | null): value is AgentSortColumn {
  return SORT_COLUMNS.includes(value as AgentSortColumn);
}

function isStatus(value: string | null): value is AgentStatus {
  return value !== null && value in STATUS_INFO;
}

function toId(value: string | null): number | undefined {
  if (!value) return undefined;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

export function AgentsPage() {
  const { data: me } = useMe();
  const canInstall = hasPermission(me, PERMISSIONS.agentsInstall);
  const canControl = hasPermission(me, PERMISSIONS.agentsControl);
  const updateAll = useMutation({
    mutationFn: () => agentActionsApi.updateAgents(),
    onSuccess: (r) =>
      notifySuccess(r.sent === 0 ? `Todos os agentes online já estão na versão ${r.version}.` : `Atualização para o EYES ${r.version} enviada a ${r.sent} agente(s).`),
  });
  const confirmUpdateAll = () =>
    confirmAction({
      title: 'Atualizar agentes',
      message: 'Enviar a atualização do EYES para todos os agentes online com versão anterior à distribuída pelo servidor? Cada serviço reinicia sozinho.',
      confirmLabel: 'Atualizar',
      onConfirm: () => updateAll.mutate(),
    });
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [installOpened, installModal] = useDisclosure(false);
  const clients = useClients();

  const clientId = toId(searchParams.get('cliente'));
  const siteId = toId(searchParams.get('site'));
  const statusParam = searchParams.get('status');
  const status = isStatus(statusParam) ? statusParam : undefined;
  const page = toId(searchParams.get('pagina')) ?? 1;
  const sortParam = searchParams.get('ordem');
  const sort: SortState<AgentSortColumn> = {
    key: isSortColumn(sortParam) ? sortParam : 'hostname',
    direction: searchParams.get('sentido') === 'desc' ? 'desc' : 'asc',
  };
  // Nova ordenacao volta para a primeira pagina (updateParams apaga "pagina"); hostname crescente e o padrao.
  const onSort = (next: SortState<AgentSortColumn>) =>
    updateParams({
      ordem: next.key === 'hostname' && next.direction === 'asc' ? undefined : next.key,
      sentido: next.direction === 'desc' ? 'desc' : undefined,
    });
  const [search, setSearch] = useState(searchParams.get('busca') ?? '');

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

  const currentSearch = searchParams.get('busca') ?? '';
  const applySearch = useDebouncedCallback((value: string) => updateParams({ busca: value.trim() || undefined }), 300);

  const params: ListAgentsParams = {
    page,
    pageSize: PAGE_SIZE,
    clientId,
    siteId,
    status,
    search: currentSearch || undefined,
    sortBy: sort.key,
    sortDir: sort.direction,
  };
  const agents = useQuery({
    queryKey: queryKeys.agentList(params),
    queryFn: () => agentsApi.list(params),
    placeholderData: keepPreviousData,
  });

  const clientOptions = (clients.data ?? []).map((c) => ({ value: String(c.id), label: c.name }));
  const selectedClient = clients.data?.find((c) => c.id === clientId);
  const siteOptions = (selectedClient?.sites ?? []).map((s) => ({ value: String(s.id), label: s.name }));
  const hasFilters = Boolean(clientId ?? siteId ?? status ?? currentSearch);
  const rows = agents.data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Agentes"
        description="Estações e servidores monitorados."
        actions={
          <Group gap="sm">
            {canControl && (
              <Button variant="light" leftSection={<IconCloudDownload size={16} />} loading={updateAll.isPending} onClick={confirmUpdateAll}>
                Atualizar agentes
              </Button>
            )}
            {canInstall && (
              <Button leftSection={<IconDownload size={16} />} onClick={installModal.open}>
                Instalar agente
              </Button>
            )}
          </Group>
        }
      />
      <Group mb="md" gap="sm" align="flex-end" wrap="wrap">
        <TextInput
          placeholder="Hostname, descrição, usuário ou IP"
          aria-label="Buscar agentes"
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
          data={clientOptions}
          value={clientId ? String(clientId) : null}
          onChange={(value) => updateParams({ cliente: value ?? undefined, site: undefined })}
          clearable
          searchable
          w={200}
        />
        <Select
          aria-label="Filtrar por site"
          placeholder={selectedClient ? 'Todos os sites' : 'Escolha um cliente'}
          data={siteOptions}
          value={siteId ? String(siteId) : null}
          onChange={(value) => updateParams({ site: value ?? undefined })}
          disabled={!selectedClient}
          clearable
          searchable
          w={200}
        />
        <Select
          aria-label="Filtrar por status"
          placeholder="Todos os status"
          data={STATUS_OPTIONS}
          value={status ?? null}
          onChange={(value) => updateParams({ status: value ?? undefined })}
          clearable
          w={170}
        />
        {hasFilters && (
          <Button
            variant="subtle"
            onClick={() => {
              applySearch.cancel();
              setSearch('');
              setSearchParams({}, { replace: true });
            }}
          >
            Limpar filtros
          </Button>
        )}
      </Group>
      {agents.isError && <LoadError error={agents.error} onRetry={() => void agents.refetch()} />}
      <Paper withBorder>
        <Table.ScrollContainer minWidth={1100}>
          <Table striped highlightOnHover verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <SortableTh label="Status" column="status" sort={sort} onSort={onSort} />
                <SortableTh label="Hostname" column="hostname" sort={sort} onSort={onSort} />
                <SortableTh label="Cliente / site" column="client" sort={sort} onSort={onSort} />
                <SortableTh label="Tipo" column="type" sort={sort} onSort={onSort} />
                <SortableTh label="Sistema" column="os" sort={sort} onSort={onSort} />
                <SortableTh label="Usuário logado" column="user" sort={sort} onSort={onSort} />
                <SortableTh label="Versão" column="version" sort={sort} onSort={onSort} />
                <SortableTh label="Visto por último" column="lastSeen" sort={sort} onSort={onSort} />
                <SortableTh label="Reinício" column="reboot" sort={sort} onSort={onSort} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {agents.isPending && <LoadingRows columns={COLUMNS} />}
              {agents.isSuccess && rows.length === 0 && (
                <EmptyRow
                  columns={COLUMNS}
                  message={hasFilters ? 'Nenhum agente encontrado com esses filtros.' : 'Nenhum agente instalado ainda.'}
                />
              )}
              {rows.map((agent) => {
                const user = loggedUser(agent);
                return (
                  <Table.Tr key={agent.id} style={{ cursor: 'pointer' }} onClick={() => void navigate(agentPath(agent.id))}>
                    <Table.Td>
                      <AgentStatusBadge status={agent.status} />
                    </Table.Td>
                    <Table.Td>
                      <Anchor component={Link} to={agentPath(agent.id)} fw={500} size="sm" onClick={(e) => e.stopPropagation()}>
                        {agent.hostname}
                      </Anchor>
                      {agent.description && (
                        <Text size="xs" c="dimmed" lineClamp={1}>
                          {agent.description}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{agent.clientName}</Text>
                      <Text size="xs" c="dimmed">
                        {agent.siteName}
                      </Text>
                    </Table.Td>
                    <Table.Td>{MONITORING_TYPE_LABEL[agent.monitoringType]}</Table.Td>
                    <Table.Td>
                      <OperatingSystem plat={agent.plat} operatingSystem={agent.operatingSystem} />
                    </Table.Td>
                    <Table.Td>{user ?? <Text size="sm" c="dimmed">Nenhum</Text>}</Table.Td>
                    <Table.Td>{agent.version}</Table.Td>
                    <Table.Td>
                      <RelativeTime value={agent.lastSeen} />
                    </Table.Td>
                    <Table.Td>
                      {agent.needsReboot && (
                        <Tooltip label="O sistema pediu reinício">
                          <Badge color="yellow" variant="light" size="sm" leftSection={<IconRefreshAlert size={12} aria-hidden />}>
                            Pendente
                          </Badge>
                        </Tooltip>
                      )}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
      {agents.data && (
        <Group justify="space-between" mt="md">
          <Text size="sm" c="dimmed">
            {agents.data.total} {agents.data.total === 1 ? 'agente' : 'agentes'}
          </Text>
          <Pagination
            total={totalPages(agents.data.total, PAGE_SIZE)}
            value={page}
            onChange={(next) => updateParams({ pagina: next > 1 ? String(next) : undefined })}
            size="sm"
            getControlProps={(control) => ({
              'aria-label': control === 'previous' ? 'Página anterior' : control === 'next' ? 'Próxima página' : undefined,
            })}
          />
        </Group>
      )}
      {canInstall && <InstallAgentModal opened={installOpened} onClose={installModal.close} />}
    </>
  );
}
