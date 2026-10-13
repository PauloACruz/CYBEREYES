import { useEffect, useRef } from 'react';
import { Alert, Box, Button, Center, Group, Loader, Paper, ScrollArea, Stack, Text } from '@mantine/core';
import { IconAlertTriangle, IconPlayerStop } from '@tabler/icons-react';
import { useMutation } from '@tanstack/react-query';
import { appRunsApi } from '../../api/webapps';
import { formatDateTime } from '../../lib/format';
import { cleanTerminalText } from './terminalText';
import { useLiveRun } from './useLiveRun';
import { RunStatusBadge } from './WebAppStatusBadge';

function duration(start: string, end: string | null): string {
  const seconds = Math.max(0, Math.round(((end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime()) / 1000));
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

interface RunOutputProps {
  runId: number;
  canCancel: boolean;
  /** Altura maxima da saida. */
  maxHeight?: number;
}

/** Saida ao vivo de um comando ou deploy, com o resultado e o botao de cancelar. */
export function RunOutput({ runId, canCancel, maxHeight = 460 }: RunOutputProps) {
  const { run, output, running } = useLiveRun(runId);
  const viewport = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const cancel = useMutation({ mutationFn: () => appRunsApi.cancel(runId) });
  const text = cleanTerminalText(output);

  useEffect(() => {
    const element = viewport.current;
    if (element && followRef.current) element.scrollTop = element.scrollHeight;
  }, [text]);

  if (!run) {
    return (
      <Center py="md">
        <Loader size="sm" aria-label="Carregando execução" />
      </Center>
    );
  }

  return (
    <Stack gap="xs">
      <Group justify="space-between" wrap="wrap" gap="xs">
        <Group gap="xs" wrap="wrap">
          <RunStatusBadge status={run.status} />
          <Text size="sm" fw={600}>
            {run.title}
          </Text>
          <Text size="xs" c="dimmed">
            {run.serverName}
            {run.webAppName ? ` · ${run.webAppName}` : ''} · {run.startedBy} · {formatDateTime(run.startedAt)} · {duration(run.startedAt, run.finishedAt)}
            {run.exitCode !== null ? ` · código ${run.exitCode}` : ''}
          </Text>
        </Group>
        {running && canCancel && (
          <Button
            size="xs"
            color="red"
            variant="light"
            leftSection={<IconPlayerStop size={14} />}
            loading={cancel.isPending}
            disabled={run.cancelRequested || cancel.isSuccess}
            onClick={() => cancel.mutate()}
          >
            {run.cancelRequested || cancel.isSuccess ? 'Cancelando...' : 'Cancelar'}
          </Button>
        )}
      </Group>
      {run.error && (
        <Alert color={run.status === 'cancelled' ? 'gray' : 'red'} icon={<IconAlertTriangle size={16} />} p="xs">
          {run.error}
        </Alert>
      )}
      <Paper withBorder bg="#1a1b1e" p={0}>
        <ScrollArea.Autosize
          mah={maxHeight}
          type="auto"
          viewportRef={viewport}
          onScrollPositionChange={({ y }) => {
            const element = viewport.current;
            if (element) followRef.current = element.scrollHeight - element.clientHeight - y < 24;
          }}
        >
          <Box
            component="pre"
            m={0}
            p="sm"
            aria-label={`Saída de ${run.title}`}
            style={{
              color: '#e9ecef',
              fontFamily: 'var(--mantine-font-family-monospace)',
              fontSize: 12.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              minHeight: 60,
            }}
          >
            {text || (running ? 'Aguardando saída...' : 'Sem saída.')}
            {running && <span aria-hidden> ▍</span>}
          </Box>
        </ScrollArea.Autosize>
      </Paper>
      {run.outputTruncated && (
        <Text size="xs" c="dimmed">
          A saída passou de 2 milhões de caracteres e o restante não foi guardado.
        </Text>
      )}
    </Stack>
  );
}
