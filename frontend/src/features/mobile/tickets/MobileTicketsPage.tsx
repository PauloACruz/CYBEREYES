import { useState } from 'react';
import { ActionIcon, Box, Button, Chip, Group, Skeleton, Stack, Text, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconAlertOctagon, IconDeviceDesktop, IconMessageCircle, IconPlus, IconSearch } from '@tabler/icons-react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { queryKeys } from '../../../api/queryKeys';
import { ticketsApi } from '../../../api/tickets';
import { PERMISSIONS, type ListTicketsParams, type TicketListItem } from '../../../api/types';
import { MOBILE_PATHS, mobileTicketPath, PATHS } from '../../../app/paths';
import { hasPermission } from '../../../auth/permissions';
import { useMe } from '../../../auth/useMe';
import { LoadError } from '../../../components/TableStates';
import { formatRelative } from '../../../lib/format';
import { TicketPriorityBadge, TicketStatusBadge } from '../../tickets/TicketBadges';
import { useTicketSummary } from '../../tickets/useTicketSummary';
import { MobileHeader, MobilePage } from '../MobilePage';
import { MOBILE_CARD } from '../mobileStyles';

type Filter = 'todos' | 'meus' | 'sem-tecnico' | 'sla';
const FILTERS: Filter[] = ['todos', 'meus', 'sem-tecnico', 'sla'];
const PAGE_SIZE = 50;

function isFilter(value: string | null): value is Filter {
  return FILTERS.includes(value as Filter);
}

function TicketCard({ ticket }: { ticket: TicketListItem }) {
  return (
    <Box
      component={Link}
      to={mobileTicketPath(ticket.id)}
      aria-label={`Chamado #${ticket.id}: ${ticket.title}`}
      p="14px 16px"
      style={{ ...MOBILE_CARD, display: 'flex', flexDirection: 'column', gap: 8, textDecoration: 'none', color: 'inherit' }}
    >
      <Group gap={8} wrap="nowrap">
        <Text size="sm" ff="monospace" c="var(--ce-text-secondary)">
          #{ticket.id}
        </Text>
        <TicketPriorityBadge priority={ticket.priority} />
        <Box ml="auto">
          <TicketStatusBadge status={ticket.status} />
        </Box>
      </Group>
      <Group gap={6} wrap="nowrap" align="flex-start">
        {ticket.unreadForTechnician && (
          <Box mt={3} display="flex">
            <IconMessageCircle size={16} color="var(--mantine-color-blue-5)" role="img" aria-label="Mensagem do usuário não respondida" />
          </Box>
        )}
        <Text fw={600} size="md" lh="22px">
          {ticket.title}
        </Text>
      </Group>
      <Group gap={8} wrap="wrap" c="var(--ce-text-secondary)">
        {ticket.hostname ? (
          <Group gap={4} wrap="nowrap" c="var(--ce-text-primary)">
            <IconDeviceDesktop size={14} aria-hidden />
            <Text span size="sm" ff="monospace">
              {ticket.hostname}
            </Text>
          </Group>
        ) : (
          <Text span size="sm" c="var(--ce-text-tertiary)">
            Sem máquina
          </Text>
        )}
        <Text span size="sm">
          {[ticket.clientName, ticket.requesterName].filter(Boolean).join(' · ')}
        </Text>
      </Group>
      <Group gap={8} wrap="wrap">
        <Text size="sm" fw={ticket.assignedToName ? 400 : 600} c={ticket.assignedToName ? undefined : 'orange'}>
          {ticket.assignedToName ?? 'Sem técnico'}
        </Text>
        {ticket.slaBreached && (
          <Group gap={4} wrap="nowrap" c="red">
            <IconAlertOctagon size={14} aria-hidden />
            <Text span size="sm" fw={600}>
              SLA estourado
            </Text>
          </Group>
        )}
        <Text size="sm" c="var(--ce-text-tertiary)" ml="auto">
          {formatRelative(ticket.updatedAt)}
        </Text>
      </Group>
    </Box>
  );
}

/** Chamados abertos com filtros rapidos: os do tecnico, sem tecnico e com SLA estourado. */
export function MobileTicketsPage() {
  const { data: me } = useMe();
  const canManage = hasPermission(me, PERMISSIONS.ticketsManage);
  const [searchParams, setSearchParams] = useSearchParams();
  const filterParam = searchParams.get('filtro');
  const filter: Filter = isFilter(filterParam) ? filterParam : 'todos';
  const [search, setSearch] = useState(searchParams.get('busca') ?? '');
  const [debounced] = useDebouncedValue(search.trim(), 300);
  const summary = useTicketSummary();

  const params: ListTicketsParams = {
    page: 1,
    pageSize: PAGE_SIZE,
    open: true,
    assigned: filter === 'meus' ? 'me' : filter === 'sem-tecnico' ? 'unassigned' : undefined,
    search: debounced || undefined,
  };
  const tickets = useQuery({
    queryKey: queryKeys.ticketList(params),
    queryFn: () => ticketsApi.list(params),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const all = tickets.data?.items ?? [];
  // Sem filtro de SLA na API: os abertos ja vem do servidor e o recorte e feito aqui.
  const items = filter === 'sla' ? all.filter((t) => t.slaBreached) : all;

  const setFilter = (next: Filter) =>
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === 'todos') params.delete('filtro');
        else params.set('filtro', next);
        return params;
      },
      { replace: true },
    );

  const counts: Record<Filter, number | undefined> = {
    todos: summary.data?.open,
    meus: summary.data?.mine,
    'sem-tecnico': summary.data?.unassigned,
    sla: summary.data?.breached,
  };
  const labels: Record<Filter, string> = { todos: 'Todos', meus: 'Meus', 'sem-tecnico': 'Sem técnico', sla: 'SLA estourado' };

  return (
    <MobilePage
      header={<MobileHeader title="Chamados" />}
      floating={
        canManage && (
          <ActionIcon
            component={Link}
            to={MOBILE_PATHS.newTicket}
            size={56}
            radius="xl"
            variant="filled"
            aria-label="Novo chamado"
            pos="fixed"
            right={20}
            bottom="calc(104px + env(safe-area-inset-bottom))"
            style={{ zIndex: 25, boxShadow: 'var(--ce-shadow-md)' }}
          >
            <IconPlus size={26} stroke={2.25} />
          </ActionIcon>
        )
      }
    >
      <Chip.Group value={filter} onChange={(v) => setFilter(isFilter(v) ? v : 'todos')}>
        <Group gap={8} wrap="nowrap" mx={-16} px={16} pb={2} role="group" aria-label="Filtrar chamados" style={{ overflowX: 'auto', scrollbarWidth: 'none' }}>
          {FILTERS.map((f) => (
            <Chip key={f} value={f} variant="outline" size="md" styles={{ label: { whiteSpace: 'nowrap' } }}>
              {labels[f]}
              {counts[f] !== undefined && (
                <Text span size="xs" fw={700} ml={6}>
                  {counts[f]}
                </Text>
              )}
            </Chip>
          ))}
        </Group>
      </Chip.Group>
      <TextInput
        aria-label="Buscar chamados"
        placeholder="Título, número, máquina ou solicitante"
        leftSection={<IconSearch size={18} />}
        size="md"
        value={search}
        onChange={(e) => {
          setSearch(e.currentTarget.value);
          setSearchParams(
            (prev) => {
              const next = new URLSearchParams(prev);
              const value = e.currentTarget.value.trim();
              if (value) next.set('busca', value);
              else next.delete('busca');
              return next;
            },
            { replace: true },
          );
        }}
      />
      {tickets.isError && <LoadError error={tickets.error} onRetry={() => void tickets.refetch()} />}
      {tickets.isPending && (
        <Stack gap={10}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} h={132} radius="md" />
          ))}
        </Stack>
      )}
      {tickets.isSuccess && items.length === 0 && (
        <Text c="var(--ce-text-secondary)" ta="center" py="xl">
          {filter === 'sla' ? 'Nenhum chamado aberto com SLA estourado.' : debounced ? 'Nenhum chamado encontrado.' : 'Nenhum chamado aberto aqui.'}
        </Text>
      )}
      <Stack gap={10} style={{ opacity: tickets.isPlaceholderData ? 0.6 : 1 }}>
        {items.map((ticket) => (
          <TicketCard key={ticket.id} ticket={ticket} />
        ))}
      </Stack>
      {tickets.data && tickets.data.total > all.length && (
        <Stack gap="xs" align="center">
          <Text size="sm" c="var(--ce-text-tertiary)">
            Mostrando {all.length} de {tickets.data.total} chamados abertos
          </Text>
          <Button component={Link} to={PATHS.tickets} variant="subtle">
            Ver todos no console
          </Button>
        </Stack>
      )}
    </MobilePage>
  );
}
