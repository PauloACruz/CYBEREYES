import { useEffect, useState } from 'react';
import { Alert, Button, Group, Loader, Paper, SegmentedControl, Select, SimpleGrid, Switch, Text, TextInput } from '@mantine/core';
import { DatePickerInput, type DatesRangeValue } from '@mantine/dates';
import { useDebouncedValue } from '@mantine/hooks';
import { IconCalendar, IconRefresh, IconSearch } from '@tabler/icons-react';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { logsApi } from '../../api/logs';
import { queryKeys } from '../../api/queryKeys';
import { snmpApi } from '../../api/snmp';
import { PERMISSIONS, type ListLogsParams, type LogLevel, type LogSummaryParams } from '../../api/types';
import { hasPermission } from '../../auth/permissions';
import { useMe } from '../../auth/useMe';
import { LoadError } from '../../components/TableStates';
import { useClients } from '../clients/useClients';
import { AgentFilterSelect } from './AgentFilterSelect';
import { isLogLevel, isPeriodPreset, LOG_LEVEL_OPTIONS, MAX_RANGE_DAYS, PERIOD_OPTIONS, resolvePeriod, type DayRange, type PeriodPreset } from './logFormat';
import { LogSummaryPanel } from './LogSummaryPanel';
import { LogTable } from './LogTable';

export const LOG_PAGE_SIZE = 100;
const AUTO_REFRESH_MS = 30_000;

interface LogsViewProps {
  /** Fixa a maquina (aba do agente) e esconde os filtros de cliente, maquina e dispositivo. */
  agentId?: number;
  /** Fixa o dispositivo SNMP (aba do dispositivo). */
  deviceId?: number;
  /** O resumo nao filtra por dispositivo; desligado na aba do dispositivo. */
  showSummary?: boolean;
}

function toId(value: string | null): number | undefined {
  if (!value) return undefined;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

export function LogsView({ agentId, deviceId, showSummary = true }: LogsViewProps) {
  const { data: me } = useMe();
  const fixed = agentId !== undefined || deviceId !== undefined;
  const canViewClients = hasPermission(me, PERMISSIONS.clientsView);
  const canViewSnmp = hasPermission(me, PERMISSIONS.snmpView);
  const clients = useClients(!fixed && canViewClients);

  const [clientId, setClientId] = useState<string | null>(null);
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const [deviceFilter, setDeviceFilter] = useState<string | null>(null);
  const [level, setLevel] = useState<LogLevel | null>(null);
  const [source, setSource] = useState('');
  const [search, setSearch] = useState('');
  const [preset, setPreset] = useState<PeriodPreset>('24h');
  const [range, setRange] = useState<DayRange>([null, null]);
  const [anchor, setAnchor] = useState(() => Date.now());
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [debounced] = useDebouncedValue({ source: source.trim(), search: search.trim() }, 300);

  const devices = useQuery({
    queryKey: queryKeys.snmpDevices({ clientId: toId(clientId) }),
    queryFn: () => snmpApi.devices({ clientId: toId(clientId) }, { silent: true }),
    enabled: !fixed && canViewSnmp,
  });

  const period = resolvePeriod(preset, range, anchor);
  const selectedAgent = agentId ?? toId(agentFilter);
  const selectedDevice = deviceId ?? toId(deviceFilter);
  const params: Omit<ListLogsParams, 'before'> = {
    agentId: selectedAgent,
    deviceId: selectedDevice,
    clientId: fixed ? undefined : toId(clientId),
    level: level ?? undefined,
    source: debounced.source || undefined,
    search: debounced.search || undefined,
    from: period.from,
    to: period.to,
    limit: LOG_PAGE_SIZE,
  };
  const summaryParams: LogSummaryParams = { agentId: selectedAgent, clientId: params.clientId, from: period.from, to: period.to };
  const summaryEnabled = showSummary && selectedDevice === undefined && !period.error;

  const customInterval = autoRefresh && preset === 'custom' ? AUTO_REFRESH_MS : false;
  const logs = useInfiniteQuery({
    queryKey: queryKeys.logList(params),
    queryFn: ({ pageParam }) => logsApi.list({ ...params, before: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    placeholderData: keepPreviousData,
    enabled: !period.error,
    refetchInterval: customInterval,
  });
  const summary = useQuery({
    queryKey: queryKeys.logSummary(summaryParams),
    queryFn: () => logsApi.summary(summaryParams),
    placeholderData: keepPreviousData,
    enabled: summaryEnabled,
    refetchInterval: customInterval,
  });

  const refresh = () => {
    if (preset !== 'custom') {
      setAnchor(Date.now());
      return;
    }
    void logs.refetch();
    if (summaryEnabled) void summary.refetch();
  };

  // Atalhos: a janela desliza com o relogio; intervalo personalizado: refetchInterval nas consultas.
  useEffect(() => {
    if (!autoRefresh || preset === 'custom') return;
    const timer = setInterval(() => setAnchor(Date.now()), AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [autoRefresh, preset]);

  const entries = logs.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <Paper withBorder p="md" mb="md">
        <SimpleGrid cols={{ base: 1, sm: 2, lg: fixed ? 3 : 4 }} spacing="sm">
          {!fixed && clients.data && (
            <Select
              label="Cliente"
              placeholder="Todos os clientes"
              clearable
              searchable
              data={clients.data.map((c) => ({ value: String(c.id), label: c.name }))}
              value={clientId}
              onChange={(v) => {
                setClientId(v);
                setAgentFilter(null);
                setDeviceFilter(null);
              }}
            />
          )}
          {!fixed && <AgentFilterSelect key={clientId ?? 'todos'} clientId={toId(clientId)} value={agentFilter} onChange={setAgentFilter} />}
          {!fixed && canViewSnmp && (
            <Select
              label="Dispositivo"
              placeholder="Todos os dispositivos"
              clearable
              searchable
              data={(devices.data ?? []).map((d) => ({ value: String(d.id), label: d.name }))}
              value={deviceFilter}
              onChange={setDeviceFilter}
            />
          )}
          <Select
            label="Nível mínimo"
            placeholder="Todos os níveis"
            clearable
            data={LOG_LEVEL_OPTIONS}
            value={level}
            onChange={(v) => setLevel(isLogLevel(v) ? v : null)}
          />
          <TextInput label="Origem" placeholder="Provedor, unidade ou subsistema" value={source} onChange={(e) => setSource(e.currentTarget.value)} />
          <TextInput
            label="Texto"
            placeholder="Buscar na mensagem"
            leftSection={<IconSearch size={16} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
        </SimpleGrid>
        <Group mt="sm" gap="sm" align="flex-end" justify="space-between" wrap="wrap">
          <Group gap="sm" align="flex-end" wrap="wrap">
            <div>
              <Text size="sm" fw={500} mb={4} id="periodo-logs">
                Período
              </Text>
              <SegmentedControl
                aria-labelledby="periodo-logs"
                data={PERIOD_OPTIONS}
                value={preset}
                onChange={(v) => {
                  if (!isPeriodPreset(v)) return;
                  setPreset(v);
                  setAnchor(Date.now());
                }}
              />
            </div>
            {preset === 'custom' && (
              <DatePickerInput
                type="range"
                label="Intervalo"
                placeholder="Escolha as datas"
                valueFormat="DD/MM/YYYY"
                leftSection={<IconCalendar size={16} />}
                allowSingleDateInRange
                maxDate={dayjs().format('YYYY-MM-DD')}
                value={range}
                onChange={(value: DatesRangeValue<string>) => setRange([value[0], value[1]])}
                error={range[0] ? period.error : undefined}
                description={`Até ${MAX_RANGE_DAYS} dias`}
                miw={240}
              />
            )}
          </Group>
          <Group gap="sm">
            {logs.isFetching && !logs.isFetchingNextPage && <Loader size="xs" aria-label="Atualizando logs" />}
            <Switch label="Atualizar a cada 30 s" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.currentTarget.checked)} />
            <Button variant="light" leftSection={<IconRefresh size={16} />} onClick={refresh}>
              Atualizar
            </Button>
          </Group>
        </Group>
      </Paper>

      {period.error && !range[0] && (
        <Alert color="blue" variant="light" mb="md">
          {period.error}
        </Alert>
      )}
      {summary.isError && <LoadError error={summary.error} onRetry={() => void summary.refetch()} />}
      {summaryEnabled && <LogSummaryPanel summary={summary.data} from={period.from} to={period.to} loading={summary.isPending} onPickSource={setSource} />}

      {logs.isError && <LoadError error={logs.error} onRetry={() => void logs.refetch()} />}
      <Paper withBorder style={{ opacity: logs.isPlaceholderData ? 0.6 : 1 }}>
        <LogTable
          entries={entries}
          loading={logs.isPending && !period.error}
          showOrigin={!fixed}
          emptyMessage="Nenhum log encontrado com estes filtros."
        />
      </Paper>
      <Group justify="space-between" mt="md">
        <Text size="sm" c="dimmed">
          {entries.length === 1 ? '1 registro exibido' : `${entries.length} registros exibidos`}
        </Text>
        {logs.hasNextPage && (
          <Button variant="default" loading={logs.isFetchingNextPage} onClick={() => void logs.fetchNextPage()}>
            Carregar mais
          </Button>
        )}
      </Group>
    </>
  );
}
