import { useState } from 'react';
import { Button, Group, Pagination, Paper, SegmentedControl, Select, Text, TextInput } from '@mantine/core';
import { useDebouncedCallback, useDisclosure } from '@mantine/hooks';
import { IconPlus, IconSearch } from '@tabler/icons-react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { queryKeys } from '../../api/queryKeys';
import { ticketQueuesApi, ticketsApi } from '../../api/tickets';
import { PERMISSIONS, type ListTicketsParams } from '../../api/types';
import { hasPermission } from '../../auth/permissions';
import { useMe } from '../../auth/useMe';
import { PageHeader } from '../../components/PageHeader';
import { LoadError } from '../../components/TableStates';
import { totalPages } from '../../lib/format';
import { CreateTicketModal } from './CreateTicketModal';
import { isTicketPriority, isTicketStatus, isTicketType, PRIORITY_OPTIONS, STATUS_OPTIONS, TYPE_OPTIONS } from './ticketFormat';
import { TicketsTable } from './TicketsTable';

const PAGE_SIZE = 50;

/** Valor do filtro de status na URL: ausente = abertos. */
const ALL_STATUSES = 'todos';
const OPEN_VALUE = 'abertos';

const STATUS_FILTER_OPTIONS = [{ value: OPEN_VALUE, label: 'Abertos' }, { value: ALL_STATUSES, label: 'Todos os status' }, ...STATUS_OPTIONS];

const ASSIGNMENT_OPTIONS = [
  { value: 'todos', label: 'Todos' },
  { value: 'meus', label: 'Meus' },
  { value: 'sem-tecnico', label: 'Sem técnico' },
];

function toId(value: string | null): number | undefined {
  if (!value) return undefined;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

function assignedParam(value: string | null): string | undefined {
  if (value === 'meus') return 'me';
  if (value === 'sem-tecnico') return 'unassigned';
  return undefined;
}

export function TicketsPage() {
  const { data: me } = useMe();
  const canManage = hasPermission(me, PERMISSIONS.ticketsManage);
  const [searchParams, setSearchParams] = useSearchParams();
  const [createOpened, createModal] = useDisclosure(false);
  const queues = useQuery({ queryKey: queryKeys.ticketQueues, queryFn: ticketQueuesApi.list });

  const statusParam = searchParams.get('status');
  const priorityParam = searchParams.get('prioridade');
  const typeParam = searchParams.get('tipo');
  const assignmentParam = searchParams.get('atribuicao');
  const currentSearch = searchParams.get('busca') ?? '';
  const [search, setSearch] = useState(currentSearch);

  const status = isTicketStatus(statusParam) ? statusParam : undefined;
  const params: ListTicketsParams = {
    open: !status && statusParam !== ALL_STATUSES ? true : undefined,
    status,
    priority: isTicketPriority(priorityParam) ? priorityParam : undefined,
    type: isTicketType(typeParam) ? typeParam : undefined,
    queueId: toId(searchParams.get('fila')),
    assigned: assignedParam(assignmentParam),
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

  const tickets = useQuery({
    queryKey: queryKeys.ticketList(params),
    queryFn: () => ticketsApi.list(params),
    placeholderData: keepPreviousData,
  });

  const statusValue = status ?? (statusParam === ALL_STATUSES ? ALL_STATUSES : OPEN_VALUE);
  const assignmentValue = assignmentParam === 'meus' || assignmentParam === 'sem-tecnico' ? assignmentParam : 'todos';

  return (
    <>
      <PageHeader
        title="Chamados"
        description="Solicitações e incidentes das máquinas atendidas."
        actions={
          canManage && (
            <Button leftSection={<IconPlus size={16} />} onClick={createModal.open}>
              Novo chamado
            </Button>
          )
        }
      />
      <Group mb="md" gap="sm" align="flex-end" wrap="wrap">
        <TextInput
          placeholder="Título, número, máquina ou solicitante"
          aria-label="Buscar chamados"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => {
            setSearch(e.currentTarget.value);
            applySearch(e.currentTarget.value);
          }}
          w={280}
        />
        <Select
          aria-label="Filtrar por status"
          data={STATUS_FILTER_OPTIONS}
          allowDeselect={false}
          value={statusValue}
          onChange={(v) => updateParams({ status: !v || v === OPEN_VALUE ? undefined : v })}
          w={190}
        />
        <Select
          aria-label="Filtrar por prioridade"
          placeholder="Todas as prioridades"
          clearable
          data={PRIORITY_OPTIONS}
          value={params.priority ?? null}
          onChange={(v) => updateParams({ prioridade: v ?? undefined })}
          w={180}
        />
        <Select
          aria-label="Filtrar por tipo"
          placeholder="Todos os tipos"
          clearable
          data={TYPE_OPTIONS}
          value={params.type ?? null}
          onChange={(v) => updateParams({ tipo: v ?? undefined })}
          w={160}
        />
        <Select
          aria-label="Filtrar por fila"
          placeholder="Todas as filas"
          clearable
          data={(queues.data ?? []).map((q) => ({ value: String(q.id), label: q.name }))}
          value={params.queueId ? String(params.queueId) : null}
          onChange={(v) => updateParams({ fila: v ?? undefined })}
          w={180}
        />
        <SegmentedControl
          aria-label="Atribuição"
          data={ASSIGNMENT_OPTIONS}
          value={assignmentValue}
          onChange={(v) => updateParams({ atribuicao: v === 'todos' ? undefined : v })}
        />
      </Group>

      {tickets.isError && <LoadError error={tickets.error} onRetry={() => void tickets.refetch()} />}
      <Paper withBorder style={{ opacity: tickets.isPlaceholderData ? 0.6 : 1 }}>
        <TicketsTable
          tickets={tickets.data?.items ?? []}
          loading={tickets.isPending}
          showMachine
          emptyMessage={params.open ? 'Nenhum chamado aberto.' : 'Nenhum chamado encontrado.'}
        />
      </Paper>
      {tickets.data && (
        <Group justify="space-between" mt="md">
          <Text size="sm" c="dimmed">
            {tickets.data.total} {tickets.data.total === 1 ? 'chamado' : 'chamados'}
          </Text>
          <Pagination
            total={totalPages(tickets.data.total, PAGE_SIZE)}
            value={params.page}
            onChange={(p) => updateParams({ pagina: p > 1 ? String(p) : undefined })}
            size="sm"
          />
        </Group>
      )}

      {canManage && <CreateTicketModal opened={createOpened} onClose={createModal.close} />}
    </>
  );
}
