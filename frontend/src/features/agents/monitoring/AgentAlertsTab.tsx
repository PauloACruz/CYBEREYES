import { useState } from 'react';
import { Group, Pagination, Paper, SegmentedControl, Text } from '@mantine/core';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { alertsApi } from '../../../api/alerts';
import { queryKeys } from '../../../api/queryKeys';
import type { AgentDetail, AlertStatusFilter, ListAlertsParams } from '../../../api/types';
import { LoadError } from '../../../components/TableStates';
import { totalPages } from '../../../lib/format';
import { isStatusFilter, STATUS_FILTER_OPTIONS } from '../../alerts/alertFormat';
import { AlertsTable } from '../../alerts/AlertsTable';

const PAGE_SIZE = 25;

export function AgentAlertsTab({ agent }: { agent: AgentDetail }) {
  const [status, setStatus] = useState<AlertStatusFilter>('all');
  const [page, setPage] = useState(1);
  const params: ListAlertsParams = { status, agentId: agent.id, page, pageSize: PAGE_SIZE };
  const alerts = useQuery({
    queryKey: queryKeys.alertList(params),
    queryFn: () => alertsApi.list(params),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <SegmentedControl
        mb="md"
        aria-label="Situação dos alertas"
        data={STATUS_FILTER_OPTIONS}
        value={status}
        onChange={(v) => {
          if (isStatusFilter(v)) setStatus(v);
          setPage(1);
        }}
      />
      {alerts.isError && <LoadError error={alerts.error} onRetry={() => void alerts.refetch()} />}
      <Paper withBorder>
        <AlertsTable
          alerts={alerts.data?.items ?? []}
          loading={alerts.isPending}
          showAgent={false}
          emptyMessage="Nenhum alerta para este agente."
        />
      </Paper>
      {alerts.data && (
        <Group justify="space-between" mt="md">
          <Text size="sm" c="dimmed">
            {alerts.data.total} {alerts.data.total === 1 ? 'alerta' : 'alertas'}
          </Text>
          <Pagination total={totalPages(alerts.data.total, PAGE_SIZE)} value={page} onChange={setPage} size="sm" />
        </Group>
      )}
    </>
  );
}
