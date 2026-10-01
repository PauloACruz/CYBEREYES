import { useState } from 'react';
import { Button, Grid, Group, Paper, ScrollArea, SimpleGrid, Skeleton, Stack, Table, Text, UnstyledButton } from '@mantine/core';
import { IconChartBar, IconTable } from '@tabler/icons-react';
import type { LogSummaryDto } from '../../api/types';
import { ChartLegend } from '../../components/charts/ChartLegend';
import { StackedBarChart } from '../../components/charts/StackedBarChart';
import { formatDateTime, formatInteger } from '../../lib/format';
import { fillHours, LOG_LEVEL_INFO, LOG_LEVELS } from './logFormat';

const LEVEL_KEYS = LOG_LEVELS.map((key) => ({ key, label: LOG_LEVEL_INFO[key].label, color: LOG_LEVEL_INFO[key].chartColor }));

interface LogSummaryPanelProps {
  summary: LogSummaryDto | undefined;
  /** Periodo consultado (ISO), para completar as horas sem eventos. */
  from?: string;
  to?: string;
  loading: boolean;
  /** Clique numa origem do ranking aplica o filtro de origem. */
  onPickSource?: (source: string) => void;
}

export function LogSummaryPanel({ summary, from, to, loading, onPickSource }: LogSummaryPanelProps) {
  const [showTable, setShowTable] = useState(false);
  if (loading && !summary) return <Skeleton height={220} mb="md" />;
  if (!summary) return null;

  const buckets = summary.perHour.length > 0 ? fillHours(summary.perHour, from, to) : [];
  const topMax = Math.max(1, ...summary.bySource.map((s) => s.count));

  return (
    <Stack gap="md" mb="md">
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm" role="list" aria-label="Contagem por nível">
        {LOG_LEVELS.map((level) => {
          const info = LOG_LEVEL_INFO[level];
          return (
            <Paper key={level} withBorder p="sm" role="listitem" aria-label={`${info.label}: ${summary.byLevel[level]}`}>
              <Group gap={6} wrap="nowrap">
                <info.icon size={16} color={info.chartColor} aria-hidden />
                <Text size="sm" c="dimmed">
                  {info.label}
                </Text>
              </Group>
              <Text fz={26} fw={700} lh={1.2}>
                {formatInteger(summary.byLevel[level])}
              </Text>
            </Paper>
          );
        })}
      </SimpleGrid>
      <Grid gap="md">
        <Grid.Col span={{ base: 12, md: 8 }}>
          <Paper withBorder p="md" h="100%">
            <Group justify="space-between" mb="xs" wrap="wrap">
              <Text fw={600} size="sm">
                Eventos por hora
              </Text>
              {buckets.length > 0 && (
                <Button
                  size="xs"
                  variant="subtle"
                  leftSection={showTable ? <IconChartBar size={14} /> : <IconTable size={14} />}
                  onClick={() => setShowTable((v) => !v)}
                >
                  {showTable ? 'Ver gráfico' : 'Ver tabela'}
                </Button>
              )}
            </Group>
            {buckets.length === 0 ? (
              <Text size="sm" c="dimmed">
                Nenhum evento no período.
              </Text>
            ) : showTable ? (
              <ScrollArea.Autosize mah={220} type="auto">
                <Table striped verticalSpacing={4}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Hora</Table.Th>
                      {LOG_LEVELS.map((l) => (
                        <Table.Th key={l} ta="right">
                          {LOG_LEVEL_INFO[l].label}
                        </Table.Th>
                      ))}
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {[...buckets]
                      .reverse()
                      .filter((b) => LOG_LEVELS.some((l) => b.values[l] > 0))
                      .map((b) => (
                      <Table.Tr key={b.time}>
                        <Table.Td>{formatDateTime(b.time)}</Table.Td>
                        {LOG_LEVELS.map((l) => (
                          <Table.Td key={l} ta="right" style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {formatInteger(b.values[l])}
                          </Table.Td>
                        ))}
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea.Autosize>
            ) : (
              <Stack gap="xs">
                <ChartLegend items={LEVEL_KEYS.map((k) => ({ label: k.label, color: k.color }))} />
                <StackedBarChart buckets={buckets} keys={LEVEL_KEYS} label="Eventos por hora, empilhados por nível" />
              </Stack>
            )}
          </Paper>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Paper withBorder p="md" h="100%">
            <Text fw={600} size="sm" mb="xs">
              Principais origens
            </Text>
            {summary.bySource.length === 0 ? (
              <Text size="sm" c="dimmed">
                Nenhuma origem no período.
              </Text>
            ) : (
              <Stack gap={6} component="ol" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {summary.bySource.map((s) => (
                  <li key={s.source}>
                    <UnstyledButton
                      w="100%"
                      onClick={onPickSource ? () => onPickSource(s.source) : undefined}
                      disabled={!onPickSource}
                      aria-label={`Filtrar pela origem ${s.source} (${s.count} eventos)`}
                    >
                      <Group justify="space-between" wrap="nowrap" gap="xs">
                        <Text size="sm" truncate="end" title={s.source}>
                          {s.source}
                        </Text>
                        <Text size="sm" fw={600} style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {formatInteger(s.count)}
                        </Text>
                      </Group>
                      <div
                        aria-hidden
                        style={{
                          height: 4,
                          borderRadius: 2,
                          marginTop: 2,
                          width: `${Math.max((s.count / topMax) * 100, 2)}%`,
                          background: 'var(--wc-chart-1)',
                        }}
                      />
                    </UnstyledButton>
                  </li>
                ))}
              </Stack>
            )}
          </Paper>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
