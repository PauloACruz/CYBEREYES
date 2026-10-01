import { useState } from 'react';
import { Button, Center, Group, Loader, ScrollArea, SegmentedControl, Stack, Table, Text } from '@mantine/core';
import { IconChartLine, IconTable } from '@tabler/icons-react';
import { keepPreviousData, useQueries } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import { snmpApi } from '../../api/snmp';
import { ChartLegend } from '../../components/charts/ChartLegend';
import { TimeSeriesChart, type ChartThreshold, type TimeSeries } from '../../components/charts/TimeSeriesChart';
import { LoadError } from '../../components/TableStates';
import { formatDateTime } from '../../lib/format';

const PERIODS = [
  { value: '1', label: '1 h' },
  { value: '24', label: '24 h' },
  { value: '168', label: '7 dias' },
];

export interface MetricSeries {
  metric: string;
  label: string;
  color: string;
}

interface MetricChartPanelProps {
  deviceId: number;
  title: string;
  series: MetricSeries[];
  formatValue: (value: number) => string;
  thresholds?: ChartThreshold[];
}

/** Grafico de metricas do dispositivo (GET .../metrics) com periodo e alternancia para tabela. */
export function MetricChartPanel({ deviceId, title, series, formatValue, thresholds }: MetricChartPanelProps) {
  const [hours, setHours] = useState(24);
  const [showTable, setShowTable] = useState(false);
  const results = useQueries({
    queries: series.map((s) => ({
      queryKey: queryKeys.snmpMetrics(deviceId, s.metric, hours),
      queryFn: () => {
        const to = new Date();
        const from = new Date(to.getTime() - hours * 3_600_000);
        return snmpApi.metrics(deviceId, { metric: s.metric, from: from.toISOString(), to: to.toISOString() });
      },
      placeholderData: keepPreviousData,
    })),
  });
  const failed = results.find((r) => r.isError);
  const pending = results.some((r) => r.isPending);
  const fetching = results.some((r) => r.isFetching);
  const chartSeries: TimeSeries[] = series.map((s, i) => ({
    key: s.metric,
    label: s.label,
    color: s.color,
    points: results[i]?.data?.points ?? [],
  }));
  const hasPoints = chartSeries.some((s) => s.points.length > 0);
  const tableTimes = [...new Set(chartSeries.flatMap((s) => s.points.map((p) => p.time)))].sort().reverse();
  const lookup = chartSeries.map((s) => new Map(s.points.map((p) => [p.time, p.value])));

  return (
    <Stack gap="sm">
      <Group justify="space-between" wrap="wrap">
        <Text fw={600} size="sm">
          {title}
        </Text>
        <Group gap="sm">
          {fetching && <Loader size="xs" aria-label="Atualizando gráfico" />}
          <SegmentedControl size="xs" data={PERIODS} value={String(hours)} onChange={(v) => setHours(Number(v))} aria-label={`Período de ${title.toLowerCase()}`} />
          {hasPoints && (
            <Button
              size="xs"
              variant="subtle"
              leftSection={showTable ? <IconChartLine size={14} /> : <IconTable size={14} />}
              onClick={() => setShowTable((v) => !v)}
            >
              {showTable ? 'Ver gráfico' : 'Ver tabela'}
            </Button>
          )}
        </Group>
      </Group>
      {failed && <LoadError error={failed.error} onRetry={() => results.forEach((r) => void r.refetch())} />}
      {pending && (
        <Center py="md">
          <Loader size="sm" aria-label="Carregando gráfico" />
        </Center>
      )}
      {!pending && !failed && !hasPoints && (
        <Text size="sm" c="dimmed">
          Sem leituras no período.
        </Text>
      )}
      {hasPoints &&
        (showTable ? (
          <ScrollArea.Autosize mah={260} type="auto">
            <Table striped verticalSpacing={4}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Data e hora</Table.Th>
                  {chartSeries.map((s) => (
                    <Table.Th key={s.key} ta="right">
                      {s.label}
                    </Table.Th>
                  ))}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {tableTimes.map((t) => (
                  <Table.Tr key={t}>
                    <Table.Td>{formatDateTime(t)}</Table.Td>
                    {chartSeries.map((s, i) => {
                      const v = lookup[i]?.get(t);
                      return (
                        <Table.Td key={s.key} ta="right" style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {v === undefined ? 'Sem leitura' : formatValue(v)}
                        </Table.Td>
                      );
                    })}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea.Autosize>
        ) : (
          <Stack gap="xs">
            {chartSeries.length > 1 && <ChartLegend items={chartSeries.map((s) => ({ label: s.label, color: s.color }))} />}
            <TimeSeriesChart series={chartSeries} formatValue={formatValue} label={`Gráfico de ${title.toLowerCase()}`} thresholds={thresholds} />
          </Stack>
        ))}
    </Stack>
  );
}
