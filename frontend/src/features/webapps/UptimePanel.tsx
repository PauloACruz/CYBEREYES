import { useState } from 'react';
import { Box, Center, Group, Loader, Paper, SegmentedControl, SimpleGrid, Stack, Table, Text, Tooltip } from '@mantine/core';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import type { WebAppDetail } from '../../api/types';
import { webAppsApi } from '../../api/webapps';
import { TimeSeriesChart } from '../../components/charts/TimeSeriesChart';
import { LoadError } from '../../components/TableStates';
import { formatDate, formatDateTime } from '../../lib/format';
import { daysUntil, formatLatency, formatUptime, uptimeColor } from './webappFormat';

const PERIODS = [
  { value: '24', label: '24 h' },
  { value: '168', label: '7 dias' },
  { value: '720', label: '30 dias' },
];

function Stat({ label, value, color, hint }: { label: string; value: string; color?: string; hint?: string }) {
  return (
    <Paper withBorder p="sm">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text size="xl" fw={700} c={color} mt={2}>
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

function outageDuration(start: string, end: string | null): string {
  const minutes = Math.max(0, Math.round(((end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours} h ${minutes % 60} min` : `${Math.floor(hours / 24)} dias`;
}

/** Disponibilidade da aplicacao: percentuais, faixa de verificacoes, tempo de resposta e quedas recentes. */
export function UptimePanel({ app }: { app: WebAppDetail }) {
  const [hours, setHours] = useState(24);
  const checks = useQuery({
    queryKey: queryKeys.webAppChecks(app.id, hours),
    queryFn: () => webAppsApi.checks(app.id, hours),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const ssl = daysUntil(app.sslExpiresAt);

  if (checks.isError) return <LoadError error={checks.error} onRetry={() => void checks.refetch()} />;
  if (!checks.data) {
    return (
      <Center py="xl">
        <Loader aria-label="Carregando disponibilidade" />
      </Center>
    );
  }
  const { uptime, points, outages } = checks.data;
  const latency = points.filter((p) => p.latencyMs !== null).map((p) => ({ time: p.time, value: p.latencyMs ?? 0 }));

  return (
    <Stack>
      <SimpleGrid cols={{ base: 2, sm: 3, lg: 5 }}>
        <Stat label="Disponibilidade 24 h" value={formatUptime(uptime.h24)} color={uptimeColor(uptime.h24)} />
        <Stat label="7 dias" value={formatUptime(uptime.d7)} color={uptimeColor(uptime.d7)} />
        <Stat label="30 dias" value={formatUptime(uptime.d30)} color={uptimeColor(uptime.d30)} />
        <Stat
          label="Tempo de resposta"
          value={formatLatency(app.lastLatencyMs)}
          hint={app.lastStatusCode ? `Última resposta HTTP ${app.lastStatusCode}` : undefined}
        />
        <Stat
          label="Certificado TLS"
          value={ssl === null ? 'Sem TLS' : ssl < 0 ? 'Vencido' : `${ssl} dias`}
          color={ssl === null ? undefined : ssl < 0 ? 'red' : ssl <= app.sslWarnDays ? 'orange' : 'teal'}
          hint={app.sslExpiresAt ? `Vence em ${formatDate(app.sslExpiresAt)}` : undefined}
        />
      </SimpleGrid>

      <Paper withBorder p="md">
        <Group justify="space-between" mb="sm" wrap="wrap">
          <Text fw={600} size="sm">
            Verificações
          </Text>
          <Group gap="sm">
            {checks.isFetching && <Loader size="xs" aria-label="Atualizando" />}
            <SegmentedControl size="xs" data={PERIODS} value={String(hours)} onChange={(v) => setHours(Number(v))} aria-label="Período" />
          </Group>
        </Group>
        {points.length === 0 ? (
          <Text size="sm" c="dimmed">
            {app.monitorEnabled ? 'Nenhuma verificação no período ainda.' : 'O monitoramento está desligado nesta aplicação.'}
          </Text>
        ) : (
          <Stack gap="md">
            <Box style={{ display: 'flex', gap: 1, height: 28 }} role="img" aria-label="Faixa de disponibilidade: verde no ar, vermelho com falha">
              {points.map((p) => (
                <Tooltip
                  key={p.time}
                  withArrow
                  multiline
                  maw={320}
                  label={`${formatDateTime(p.time)} · ${p.failures === 0 ? 'no ar' : `${p.failures} de ${p.checks} com falha`}${p.error ? ` · ${p.error}` : ''}`}
                >
                  <Box
                    style={{
                      flex: 1,
                      minWidth: 2,
                      borderRadius: 2,
                      background: p.failures === 0 ? 'var(--mantine-color-teal-5)' : p.failures === p.checks ? 'var(--mantine-color-red-6)' : 'var(--mantine-color-orange-5)',
                    }}
                  />
                </Tooltip>
              ))}
            </Box>
            {latency.length > 0 && (
              <TimeSeriesChart
                label="Tempo de resposta"
                series={[{ key: 'latency', label: 'Tempo de resposta', color: 'var(--ce-chart-1)', points: latency }]}
                formatValue={(v) => formatLatency(Math.round(v))}
              />
            )}
          </Stack>
        )}
      </Paper>

      <Paper withBorder>
        <Text fw={600} size="sm" p="sm" pb={0}>
          Quedas recentes
        </Text>
        {outages.length === 0 ? (
          <Text size="sm" c="dimmed" p="sm">
            Nenhuma queda registrada.
          </Text>
        ) : (
          <Table.ScrollContainer minWidth={640}>
            <Table verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={170}>Início</Table.Th>
                  <Table.Th w={170}>Volta</Table.Th>
                  <Table.Th w={120}>Duração</Table.Th>
                  <Table.Th>Motivo</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {outages.map((o) => (
                  <Table.Tr key={o.id}>
                    <Table.Td>{formatDateTime(o.start)}</Table.Td>
                    <Table.Td>
                      {o.end ? (
                        formatDateTime(o.end)
                      ) : (
                        <Text size="sm" c="red" fw={600}>
                          {o.resolved ? 'Resolvido à mão' : 'Ainda fora do ar'}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>{outageDuration(o.start, o.end)}</Table.Td>
                    <Table.Td>
                      <Text size="sm" lineClamp={2}>
                        {o.message}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Paper>
    </Stack>
  );
}
