import { useEffect, useRef } from 'react';
import { Alert, Badge, Box, Button, Code, Group, Loader, Paper, Progress, ScrollArea, Skeleton, Stack, Table, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconCircleX,
  IconClock,
  IconPlayerSkipForward,
  IconPlayerStop,
  IconRefreshAlert,
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import type { CareCatalog, CareDoneEvent, CareEvent, CareProgressEvent, CareResultEvent, CareRunDto, CareTaskStatus } from '../../api/types';
import { careApi } from '../../api/care';
import { LoadError } from '../../components/TableStates';
import { formatDateTime } from '../../lib/format';
import { useConsoleHubConnection } from '../../realtime/consoleHubContext';
import { applyRunEvent } from './runEvents';
import {
  CARE_NAME,
  formatDuration,
  LOG_LEVEL_COLOR,
  moduleLabel,
  RUN_STATUS_COLOR,
  RUN_STATUS_LABEL,
  TASK_STATUS_LABEL,
  taskLabel,
} from './careFormat';

/** Entra no grupo da execucao no hub e acrescenta os eventos recebidos ao cache. */
function useRunRealtime(runId: string) {
  const queryClient = useQueryClient();
  const { connection, connected } = useConsoleHubConnection();

  useEffect(() => {
    if (!connection) return;
    const onEvent = (eventRunId: string, event: CareEvent) => {
      if (eventRunId !== runId) return;
      queryClient.setQueryData<CareRunDto>(queryKeys.careRun(runId), (prev) => (prev ? applyRunEvent(prev, event) : prev));
    };
    connection.on('careEvent', onEvent);
    return () => connection.off('careEvent', onEvent);
  }, [connection, runId, queryClient]);

  useEffect(() => {
    if (!connection || !connected) return;
    connection.invoke('JoinCareRun', runId).catch(() => undefined);
    return () => {
      connection.invoke('LeaveCareRun', runId).catch(() => undefined);
    };
  }, [connection, connected, runId]);
}

function TaskStatusIcon({ status }: { status: CareTaskStatus | undefined }) {
  switch (status) {
    case 'running':
      return <Loader size={16} aria-hidden />;
    case 'ok':
      return <IconCircleCheck size={18} color="var(--mantine-color-teal-6)" aria-hidden />;
    case 'warning':
      return <IconAlertTriangle size={18} color="var(--mantine-color-orange-6)" aria-hidden />;
    case 'error':
      return <IconCircleX size={18} color="var(--mantine-color-red-6)" aria-hidden />;
    case 'skipped':
      return <IconPlayerSkipForward size={18} color="var(--mantine-color-gray-6)" aria-hidden />;
    default:
      return <IconClock size={18} color="var(--mantine-color-gray-5)" aria-hidden />;
  }
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('pt-BR');
}

function LogConsole({ events }: { events: CareEvent[] }) {
  const viewport = useRef<HTMLDivElement>(null);
  const logs = events.filter((e) => e.type === 'log');
  const count = logs.length;

  useEffect(() => {
    const el = viewport.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);

  return (
    <ScrollArea h={260} viewportRef={viewport} type="auto" style={{ background: 'var(--mantine-color-dark-8)', borderRadius: 'var(--mantine-radius-sm)' }}>
      <Box role="log" aria-label="Log da execução" aria-live="polite" p="sm" ff="monospace" fz="xs">
        {count === 0 && <Text c="gray.5" fz="xs">Aguardando mensagens do agente...</Text>}
        {logs.map((e) => (
          <div key={e.seq} data-level={e.level} style={{ color: LOG_LEVEL_COLOR[e.level], whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            <span style={{ opacity: 0.6 }}>{formatTime(e.time)} </span>
            <span>{e.message}</span>
          </div>
        ))}
      </Box>
    </ScrollArea>
  );
}

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function ResultView({ event }: { event: CareResultEvent }) {
  const { data } = event;
  if (Array.isArray(data) && data.length > 0 && data.every(isRow)) {
    const rows: Row[] = data;
    const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    return (
      <Table.ScrollContainer minWidth={Math.max(320, columns.length * 140)}>
        <Table striped verticalSpacing={4} fz="sm">
          <Table.Thead>
            <Table.Tr>
              {columns.map((c) => (
                <Table.Th key={c}>{c}</Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((row, index) => (
              <Table.Tr key={index}>
                {columns.map((c) => (
                  <Table.Td key={c}>{cellText(row[c])}</Table.Td>
                ))}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    );
  }
  return (
    <ScrollArea.Autosize mah={320} type="auto">
      <Code block>{JSON.stringify(data, null, 2)}</Code>
    </ScrollArea.Autosize>
  );
}

function RunSummary({ run, done }: { run: CareRunDto; done: CareDoneEvent | undefined }) {
  if (run.status === 'running') return null;
  const color = RUN_STATUS_COLOR[run.status];
  const duration = done
    ? formatDuration(done.durationMs)
    : run.finishedAt
      ? formatDuration(new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime())
      : null;
  return (
    <Stack gap="xs">
      <Alert color={color} variant="light" title={RUN_STATUS_LABEL[run.status]}>
        {duration ? `Duração: ${duration}.` : `Finalizado em ${formatDateTime(run.finishedAt)}.`}
      </Alert>
      {run.rebootRequired && (
        <Alert color="yellow" variant="light" icon={<IconRefreshAlert size={18} />} title="Reinício necessário">
          Reinicie a máquina para concluir as alterações.
        </Alert>
      )}
    </Stack>
  );
}

interface RunPanelProps {
  runId: string;
  catalog: CareCatalog | undefined;
  canRun: boolean;
}

export function RunPanel({ runId, catalog, canRun }: RunPanelProps) {
  useRunRealtime(runId);
  const run = useQuery({ queryKey: queryKeys.careRun(runId), queryFn: () => careApi.run(runId) });
  const cancel = useMutation({
    mutationFn: () => careApi.cancel(runId),
    onSuccess: () => notifications.show({ color: 'blue', title: CARE_NAME, message: 'Cancelamento solicitado ao agente.' }),
  });

  if (run.isError) return <LoadError error={run.error} onRetry={() => void run.refetch()} />;
  if (!run.data) return <Skeleton height={240} />;
  const data = run.data;
  const events = data.events ?? [];
  const running = data.status === 'running';
  const lastProgress = events.findLast((e): e is CareProgressEvent => e.type === 'progress');
  const done = events.findLast((e): e is CareDoneEvent => e.type === 'done');
  const results = events.filter((e): e is CareResultEvent => e.type === 'result');

  return (
    <Paper withBorder p="md" component="section" aria-label={`Execução do ${CARE_NAME}`}>
      <Stack gap="md">
        <Group justify="space-between" wrap="wrap" gap="xs">
          <div>
            <Title order={5}>
              {moduleLabel(catalog, data.module)}
            </Title>
            <Text size="xs" c="dimmed">
              Iniciada em {formatDateTime(data.startedAt)} por {data.requestedBy}
              {data.source === 'tray' ? ' (app do usuário)' : ''}
            </Text>
          </div>
          <Group gap="xs">
            <Badge color={RUN_STATUS_COLOR[data.status]} variant="light" aria-label="Situação da execução">
              {RUN_STATUS_LABEL[data.status]}
            </Badge>
            {running && canRun && (
              <Button size="xs" color="red" variant="light" leftSection={<IconPlayerStop size={14} />} loading={cancel.isPending} onClick={() => cancel.mutate()}>
                Cancelar
              </Button>
            )}
          </Group>
        </Group>

        <div>
          <Group justify="space-between" mb={4}>
            <Text size="sm" c="dimmed">
              {lastProgress?.message ? lastProgress.message : 'Progresso'}
            </Text>
            <Text size="sm" fw={600}>
              {Math.round(data.progress)}%
            </Text>
          </Group>
          <Progress value={data.progress} color={RUN_STATUS_COLOR[data.status]} animated={running} striped={running} aria-label="Progresso da execução" />
        </div>

        <Stack gap={6} role="list" aria-label="Tarefas da execução">
          {data.tasks.map((key) => {
            const status = data.taskStatus[key];
            return (
              <Group key={key} gap="xs" wrap="nowrap" role="listitem">
                <TaskStatusIcon status={status} />
                <Text size="sm" style={{ flex: 1 }}>
                  {taskLabel(catalog, data.module, key)}
                </Text>
                <Text size="xs" c="dimmed">
                  {status ? TASK_STATUS_LABEL[status] : 'Aguardando'}
                </Text>
              </Group>
            );
          })}
        </Stack>

        <LogConsole events={events} />

        {results.length > 0 && (
          <Stack gap="xs">
            <Title order={6}>Resultados</Title>
            {results.map((event) => (
              <ResultView key={event.seq} event={event} />
            ))}
          </Stack>
        )}

        <RunSummary run={data} done={done} />
      </Stack>
    </Paper>
  );
}
