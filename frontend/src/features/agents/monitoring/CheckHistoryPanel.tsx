import { useState } from 'react';
import { Button, Center, Group, Loader, ScrollArea, SegmentedControl, Stack, Table, Text } from '@mantine/core';
import { IconChartLine, IconTable } from '@tabler/icons-react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { checksApi } from '../../../api/monitoring';
import { queryKeys } from '../../../api/queryKeys';
import type { AgentCheckDto } from '../../../api/types';
import { OutputBlock } from '../../../components/OutputBlock';
import { LoadError } from '../../../components/TableStates';
import { formatDateTime, formatSeconds } from '../../../lib/format';
import { CheckHistoryChart } from '../../monitoring/checks/CheckHistoryChart';
import { CheckStatusBadge } from '../../monitoring/MonitoringBadges';
import { isCheckStatus } from '../../monitoring/monitoringFormat';

const PERIODS = [
  { value: '24', label: '24h' },
  { value: '168', label: '7 dias' },
  { value: '720', label: '30 dias' },
];

const MAX_OUTPUTS = 20;

export function CheckHistoryPanel({ item, agentId }: { item: AgentCheckDto; agentId: number }) {
  const { check, result } = item;
  const [hours, setHours] = useState(24);
  const [showTable, setShowTable] = useState(false);
  const numeric = check.checkType === 'diskspace' || check.checkType === 'cpuload' || check.checkType === 'memory';
  const history = useQuery({
    queryKey: queryKeys.checkHistory(check.id, agentId, hours),
    queryFn: () => checksApi.history(check.id, agentId, hours),
    placeholderData: keepPreviousData,
  });
  const points = history.data ?? [];
  const valueLabel = check.checkType === 'diskspace' ? 'Espaço livre' : check.checkType === 'memory' ? 'Uso de memória' : 'Carga de CPU';

  return (
    <Stack gap="sm" py="xs">
      <Group justify="space-between">
        <Group gap="sm">
          <SegmentedControl size="xs" data={PERIODS} value={String(hours)} onChange={(v) => setHours(Number(v))} aria-label="Período do histórico" />
          {history.isFetching && <Loader size="xs" aria-label="Atualizando histórico" />}
        </Group>
        {numeric && points.length > 0 && (
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

      {history.isError && <LoadError error={history.error} onRetry={() => void history.refetch()} />}
      {history.isPending && (
        <Center py="md">
          <Loader size="sm" aria-label="Carregando histórico" />
        </Center>
      )}
      {history.isSuccess && points.length === 0 && (
        <Text size="sm" c="dimmed">
          Sem leituras no período.
        </Text>
      )}

      {numeric && points.length > 0 && (
        <>
          <Text size="sm" fw={500}>
            {valueLabel} (%)
          </Text>
          <div style={{ opacity: history.isPlaceholderData ? 0.5 : 1 }}>
            {showTable ? (
              <ScrollArea.Autosize mah={260} type="auto">
                <Table striped>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Data e hora</Table.Th>
                      <Table.Th>{valueLabel}</Table.Th>
                      <Table.Th>Status</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {[...points].reverse().map((p) => (
                      <Table.Tr key={p.time}>
                        <Table.Td>{formatDateTime(p.time)}</Table.Td>
                        <Table.Td style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.round(p.value)}%</Table.Td>
                        <Table.Td>
                          <CheckStatusBadge status={isCheckStatus(p.status) ? p.status : null} severity={null} />
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea.Autosize>
            ) : (
              <CheckHistoryChart
                points={points}
                valueLabel={valueLabel}
                hours={hours}
                thresholds={[
                  { value: check.warningThreshold, label: 'Aviso', color: 'var(--mantine-color-orange-6)' },
                  { value: check.errorThreshold, label: 'Erro', color: 'var(--mantine-color-red-6)' },
                ]}
              />
            )}
          </div>
        </>
      )}

      {!numeric && points.length > 0 && (
        <Stack gap={6}>
          <Text size="sm" fw={500}>
            Últimas saídas
          </Text>
          <ScrollArea.Autosize mah={320} type="auto">
            <Stack gap="xs">
              {[...points]
                .reverse()
                .slice(0, MAX_OUTPUTS)
                .map((p) => (
                  <Group key={p.time} gap="sm" align="flex-start" wrap="nowrap">
                    <Text size="xs" c="dimmed" w={110} style={{ flexShrink: 0 }}>
                      {formatDateTime(p.time)}
                    </Text>
                    <CheckStatusBadge status={isCheckStatus(p.status) ? p.status : null} severity={null} />
                    <Text size="sm" ff="monospace" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {p.results || 'Sem saída.'}
                    </Text>
                  </Group>
                ))}
            </Stack>
          </ScrollArea.Autosize>
        </Stack>
      )}

      {check.checkType === 'script' && result && (
        <Stack gap="sm">
          <Group gap="lg">
            <Text size="sm">Último código de retorno: {result.retcode ?? 'Não informado'}</Text>
            {result.executionTime !== null && <Text size="sm">Tempo de execução: {formatSeconds(result.executionTime)}</Text>}
          </Group>
          <OutputBlock label="Saída padrão (stdout)" value={result.stdout ?? ''} maxHeight={240} />
          {result.stderr && <OutputBlock label="Saída de erro (stderr)" value={result.stderr} maxHeight={200} color="red" />}
        </Stack>
      )}
    </Stack>
  );
}
