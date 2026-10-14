import { useState } from 'react';
import { Button, Group, Pagination, Paper, SegmentedControl, Select, SimpleGrid, Stack, Text } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { IconFilePlus, IconTicket } from '@tabler/icons-react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { proceduresApi } from '../../api/procedures';
import { queryKeys } from '../../api/queryKeys';
import { ticketsApi } from '../../api/tickets';
import { PERMISSIONS, type ListProceduresParams, type ProcedureDto, type ProcedureKind } from '../../api/types';
import { hasPermission } from '../../auth/permissions';
import { useMe } from '../../auth/useMe';
import { LoadError } from '../../components/TableStates';
import { totalPages } from '../../lib/format';
import { useClients } from '../clients/useClients';
import { formatMinutes } from '../tickets/ticketFormat';
import { formatTotalSeconds, PROCEDURE_KIND_INFO, PROCEDURE_KINDS } from './procedureFormat';
import { IncludeInTicketModal, RegisterTicketModal } from './ProcedureTicketModals';
import { ProceduresTable } from './ProceduresTable';

const PAGE_SIZE = 50;

export type LinkedFilter = 'todos' | 'sem-chamado' | 'em-chamado';

export interface ProcedureFilters {
  clientId?: number;
  userId?: string;
  kind?: ProcedureKind;
  linked: LinkedFilter;
  /** AAAA-MM-DD */
  from?: string;
  to?: string;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Paper withBorder p="md">
      <Text size="xs" c="dimmed" fw={600} tt="uppercase" style={{ letterSpacing: '0.04em' }}>
        {label}
      </Text>
      <Text fz={24} fw={700} lh="32px">
        {value}
      </Text>
      {hint && (
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
      )}
    </Paper>
  );
}

interface ProcedureBrowserProps {
  /** Fixo na aba do agente: esconde os filtros de cliente e a coluna de maquina. */
  agentId?: number;
  filters: ProcedureFilters;
  onFiltersChange: (next: ProcedureFilters) => void;
}

/** Procedimentos com filtros, totais do filtro e as acoes de incluir em chamado ou registrar como chamado. */
export function ProcedureBrowser({ agentId, filters, onFiltersChange }: ProcedureBrowserProps) {
  const { data: me } = useMe();
  const canManageTickets = hasPermission(me, PERMISSIONS.ticketsManage);
  const canViewTickets = hasPermission(me, PERMISSIONS.ticketsView);
  const canViewClients = hasPermission(me, PERMISSIONS.clientsView);
  const clients = useClients(canViewClients && agentId === undefined);
  const technicians = useQuery({ queryKey: queryKeys.ticketAssignees, queryFn: ticketsApi.assignees, enabled: canViewTickets, staleTime: 60_000 });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [dialog, setDialog] = useState<'include' | 'register' | null>(null);
  const [chosen, setChosen] = useState<ProcedureDto[]>([]);

  const params: ListProceduresParams = {
    agentId,
    clientId: agentId === undefined ? filters.clientId : undefined,
    userId: filters.userId,
    kind: filters.kind,
    linked: filters.linked === 'todos' ? undefined : filters.linked === 'em-chamado',
    from: filters.from,
    to: filters.to,
    page,
    pageSize: PAGE_SIZE,
  };
  const procedures = useQuery({ queryKey: queryKeys.procedureList(params), queryFn: () => proceduresApi.list(params), placeholderData: keepPreviousData });
  const items = procedures.data?.items ?? [];
  const totals = procedures.data?.totals;

  const update = (next: Partial<ProcedureFilters>) => {
    setPage(1);
    setSelected(new Set());
    onFiltersChange({ ...filters, ...next });
  };
  const open = (kind: 'include' | 'register') => {
    setChosen(items.filter((p) => selected.has(p.id)));
    setDialog(kind);
  };
  const done = () => {
    setDialog(null);
    setSelected(new Set());
  };

  return (
    <Stack gap="md">
      <Group gap="sm" align="flex-end" wrap="wrap" role="group" aria-label="Filtros de procedimentos">
        {agentId === undefined && canViewClients && (
          <Select
            label="Cliente"
            placeholder="Todos"
            data={(clients.data ?? []).map((c) => ({ value: String(c.id), label: c.name }))}
            value={filters.clientId ? String(filters.clientId) : null}
            onChange={(v) => update({ clientId: v ? Number(v) : undefined })}
            clearable
            searchable
            w={220}
          />
        )}
        {canViewTickets && (
          <Select
            label="Técnico"
            placeholder="Todos"
            data={(technicians.data ?? []).map((t) => ({ value: t.id, label: t.name }))}
            value={filters.userId ?? null}
            onChange={(v) => update({ userId: v ?? undefined })}
            clearable
            searchable
            w={200}
          />
        )}
        <Select
          label="Tipo"
          placeholder="Todos"
          data={PROCEDURE_KINDS.map((k) => ({ value: k, label: PROCEDURE_KIND_INFO[k].label }))}
          value={filters.kind ?? null}
          onChange={(v) => update({ kind: v ?? undefined })}
          clearable
          w={190}
        />
        <DatePickerInput
          type="range"
          label="Período"
          placeholder="Todo o histórico"
          valueFormat="DD/MM/YYYY"
          value={[filters.from ?? null, filters.to ?? null]}
          onChange={([from, to]) => {
            if ((from && to) || (!from && !to)) update({ from: from ?? undefined, to: to ?? undefined });
          }}
          maxDate={dayjs().format('YYYY-MM-DD')}
          clearable
          allowSingleDateInRange
          w={230}
        />
        <Stack gap={4}>
          <Text size="sm" fw={500} id="filtro-chamado">
            Chamado
          </Text>
          <SegmentedControl
            aria-labelledby="filtro-chamado"
            value={filters.linked}
            onChange={(v) => update({ linked: v })}
            data={[
              { value: 'todos', label: 'Todos' },
              { value: 'sem-chamado', label: 'Sem chamado' },
              { value: 'em-chamado', label: 'Em chamado' },
            ]}
          />
        </Stack>
      </Group>

      <SimpleGrid cols={{ base: 2, md: 4 }} spacing="sm" aria-live="polite">
        <Stat label="Procedimentos" value={String(totals?.count ?? '–')} />
        <Stat label="Tempo de execução" value={totals ? formatTotalSeconds(totals.seconds) : '–'} />
        <Stat
          label="Em chamados"
          value={String(totals?.inTickets ?? '–')}
          hint={totals ? `${formatMinutes(totals.serviceMinutes)} de serviço apontado` : undefined}
        />
        <Stat label="Sem chamado" value={String(totals?.unlinked ?? '–')} hint="Podem entrar num chamado" />
      </SimpleGrid>

      {canManageTickets && selected.size > 0 && (
        <Paper withBorder p="sm" bg="var(--ce-bg-raised)">
          <Group justify="space-between" gap="sm">
            <Text size="sm" fw={500}>
              {selected.size === 1 ? '1 procedimento selecionado' : `${selected.size} procedimentos selecionados`}
            </Text>
            <Group gap="xs">
              <Button variant="default" size="xs" onClick={() => setSelected(new Set())}>
                Limpar seleção
              </Button>
              <Button variant="light" size="xs" leftSection={<IconTicket size={16} />} onClick={() => open('include')}>
                Incluir em chamado
              </Button>
              <Button size="xs" leftSection={<IconFilePlus size={16} />} onClick={() => open('register')}>
                Registrar como chamado
              </Button>
            </Group>
          </Group>
        </Paper>
      )}

      {procedures.isError && <LoadError error={procedures.error} onRetry={() => void procedures.refetch()} />}
      <div style={{ opacity: procedures.isPlaceholderData ? 0.6 : 1 }}>
        <ProceduresTable
          procedures={items}
          loading={procedures.isPending}
          showMachine={agentId === undefined}
          emptyMessage="Nenhum procedimento com estes filtros."
          selected={canManageTickets ? selected : undefined}
          onSelectedChange={canManageTickets ? setSelected : undefined}
        />
      </div>
      {procedures.data && procedures.data.total > PAGE_SIZE && (
        <Group justify="flex-end">
          <Pagination value={page} onChange={setPage} total={totalPages(procedures.data.total, PAGE_SIZE)} size="sm" />
        </Group>
      )}

      <IncludeInTicketModal procedures={chosen} opened={dialog === 'include'} onClose={() => setDialog(null)} onDone={done} />
      <RegisterTicketModal key={chosen.map((p) => p.id).join(',')} procedures={chosen} opened={dialog === 'register'} onClose={() => setDialog(null)} onDone={done} />
    </Stack>
  );
}
