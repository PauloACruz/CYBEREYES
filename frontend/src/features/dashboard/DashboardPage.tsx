import { Box, Grid, Group, Skeleton } from '@mantine/core';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { dashboardApi } from '../../api/dashboard';
import { queryKeys } from '../../api/queryKeys';
import { PERMISSIONS, type DashboardOverviewParams, type DashboardPeriod } from '../../api/types';
import { hasPermission } from '../../auth/permissions';
import { useMe } from '../../auth/useMe';
import { PageTitle } from '../../components/PageTitle';
import { LoadError } from '../../components/TableStates';
import { AlertStats } from './AlertStats';
import { AgentsOnlineCard, ChecksCard, ProceduresCard, TicketsCard } from './DashboardCharts';
import { DashboardFilters } from './DashboardFilters';
import { DEFAULT_PERIOD, PERIODS, type DashboardFilterValues } from './filterValues';

function toId(value: string | null): number | undefined {
  if (!value) return undefined;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

export function DashboardPage() {
  const { data: me } = useMe();
  const firstName = (me?.fullName || me?.username || '').split(' ')[0] ?? '';
  const canAgents = hasPermission(me, PERMISSIONS.agentsView);
  const canTickets = hasPermission(me, PERMISSIONS.ticketsView);
  const [searchParams, setSearchParams] = useSearchParams();

  // Filtros na URL: o recorte do Painel pode ser compartilhado e sobrevive ao recarregar.
  const daysParam = Number(searchParams.get('dias'));
  const filters: DashboardFilterValues = {
    clientId: toId(searchParams.get('cliente')),
    technicianId: searchParams.get('tecnico') ?? undefined,
    days: PERIODS.includes(daysParam as DashboardPeriod) ? (daysParam as DashboardPeriod) : DEFAULT_PERIOD,
  };
  const setFilters = (next: DashboardFilterValues) => {
    const params = new URLSearchParams();
    if (next.clientId) params.set('cliente', String(next.clientId));
    if (next.technicianId) params.set('tecnico', next.technicianId);
    if (next.days !== DEFAULT_PERIOD) params.set('dias', String(next.days));
    setSearchParams(params, { replace: true });
  };
  const params: DashboardOverviewParams = { clientId: filters.clientId, technicianId: filters.technicianId, days: filters.days };
  const overview = useQuery({
    queryKey: queryKeys.dashboardOverview(params),
    queryFn: () => dashboardApi.overview(params),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
    enabled: canAgents || canTickets,
  });
  const data = overview.data;

  return (
    <>
      <Group justify="space-between" align="flex-start" mb="lg" wrap="wrap" gap="sm">
        <PageTitle title={`Olá, ${firstName}!`} description="Bem-vindo ao CYBEREYES." />
        {(canAgents || canTickets) && (
          <DashboardFilters value={filters} onChange={setFilters} canViewClients={hasPermission(me, PERMISSIONS.clientsView)} canViewTickets={canTickets} />
        )}
      </Group>
      {overview.isError && <LoadError error={overview.error} onRetry={() => void overview.refetch()} />}
      {overview.isPending && (canAgents || canTickets) && (
        <Grid mb="lg">
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Skeleton h={320} radius="md" />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Skeleton h={320} radius="md" />
          </Grid.Col>
        </Grid>
      )}
      {data && (
        <Box style={{ opacity: overview.isPlaceholderData ? 0.6 : 1, transition: 'opacity 150ms ease-out' }}>
          <Grid mb="lg">
            {data.agents && (
              <Grid.Col span={{ base: 12, md: data.tickets ? 6 : 12 }}>
                <AgentsOnlineCard agents={data.agents} />
              </Grid.Col>
            )}
            {data.tickets && (
              <Grid.Col span={{ base: 12, md: data.agents ? 6 : 12 }}>
                <TicketsCard tickets={data.tickets} technicianFiltered={Boolean(filters.technicianId)} />
              </Grid.Col>
            )}
          </Grid>
          {data.checks && (
            <Box mb="xl">
              <ChecksCard checks={data.checks} days={filters.days} />
            </Box>
          )}
          {data.procedures && (
            <Box mb="xl">
              <ProceduresCard procedures={data.procedures} technicianFiltered={Boolean(filters.technicianId)} />
            </Box>
          )}
        </Box>
      )}
      {hasPermission(me, PERMISSIONS.alertsView) && <AlertStats />}
    </>
  );
}
