import { useEffect, useRef, useState } from 'react';
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Code,
  Group,
  Loader,
  Paper,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { IconAlertTriangle, IconKeyboard, IconPlayerPlay, IconPlayerStop } from '@tabler/icons-react';
import type { HubConnection } from '@microsoft/signalr';
import { useQuery } from '@tanstack/react-query';
import { AGENT_TIMEOUT_TITLE } from '../../../api/client';
import { keyCaptureApi, type KeyCaptureSessionDto } from '../../../api/keyCapture';
import type { AgentDetail } from '../../../api/types';
import { useConsoleHubConnection } from '../../../realtime/consoleHubContext';

type Status = 'idle' | 'starting' | 'capturing' | 'stopped';
type View = 'live' | 'history';

interface LiveEntry {
  keys: string;
  ts: number;
}

function silence(promise: Promise<unknown>): void {
  promise.catch(() => undefined);
}

function startErrorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : '';
  if (/AGENT_TIMEOUT|timed? ?out/i.test(text)) return `${AGENT_TIMEOUT_TITLE}. Verifique se ele está online e tente novamente.`;
  const detail = text.split('HubException:')[1]?.trim();
  return detail ? `Não foi possível iniciar a captura: ${detail}` : 'Não foi possível iniciar a captura. Tente novamente.';
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('pt-BR');
  } catch {
    return iso;
  }
}

function formatDateLabel(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return iso;
  }
}

export function KeyCaptureTab({ agent }: { agent: AgentDetail }) {
  const { connection, connected } = useConsoleHubConnection();
  const sessionRef = useRef<string | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [liveEntries, setLiveEntries] = useState<LiveEntry[]>([]);
  const [view, setView] = useState<View>('live');
  const [historyDate, setHistoryDate] = useState<string | null>(new Date().toISOString().slice(0, 10));
  const scrollRef = useRef<HTMLDivElement>(null);

  // Verifica se ja existe captura ativa neste agente
  const activeQuery = useQuery({
    queryKey: ['keycapture-active', agent.id],
    queryFn: () => keyCaptureApi.active(agent.id),
    refetchOnWindowFocus: false,
    select: (data) => {
      if (data.active && data.sessionId) {
        sessionRef.current = data.sessionId;
      }
      return data;
    },
  });

  const activeSessionId = activeQuery.data?.active ? activeQuery.data.sessionId : null;
  if (activeSessionId && status === 'idle') {
    setStatus('capturing');
  }

  // Historico: sessoes do dia selecionado
  const dateStr = historyDate ?? undefined;
  const sessionsQuery = useQuery({
    queryKey: ['keycapture-sessions', agent.id, dateStr],
    queryFn: () => keyCaptureApi.sessions(agent.id, dateStr),
    enabled: view === 'history' && !!dateStr,
  });

  // SignalR: receber dados ao vivo e assinar/desassinar
  useEffect(() => {
    if (!connection) return;
    const hub: HubConnection = connection;

    const onData = (sessionId: string, keys: string, ts: number) => {
      if (sessionId !== sessionRef.current) return;
      setLiveEntries((prev) => [...prev, { keys, ts }]);
    };
    const onStopped = (sessionId: string) => {
      if (sessionId !== sessionRef.current) return;
      sessionRef.current = null;
      setStatus('stopped');
      setMessage('A captura foi encerrada.');
    };

    hub.on('keyCaptureData', onData);
    hub.on('keyCaptureStopped', onStopped);

    // Se ja tem sessao ativa, assinar para receber dados
    if (sessionRef.current) {
      silence(hub.invoke('WatchKeyCapture', sessionRef.current));
    }

    return () => {
      hub.off('keyCaptureData', onData);
      hub.off('keyCaptureStopped', onStopped);
      if (sessionRef.current) {
        silence(hub.invoke('UnwatchKeyCapture', sessionRef.current));
      }
    };
  }, [connection]);

  // Auto-scroll no live
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const viewport = el.querySelector<HTMLElement>('[data-viewport]');
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [liveEntries]);

  const start = async () => {
    if (!connection || !connected) return;
    setStatus('starting');
    setMessage(null);
    setLiveEntries([]);
    try {
      const sessionId = await connection.invoke<string>('StartKeyCapture', agent.id);
      sessionRef.current = sessionId;
      setStatus('capturing');
    } catch (error) {
      setStatus('stopped');
      setMessage(startErrorMessage(error));
    }
  };

  const stop = () => {
    const id = sessionRef.current;
    sessionRef.current = null;
    if (id && connection) silence(connection.invoke('StopKeyCapture', id));
    setStatus('stopped');
    setMessage('Você encerrou a captura.');
    void activeQuery.refetch();
  };

  const effective: Status =
    status === 'capturing' && !connected ? 'stopped' : status;
  const shownMessage =
    status === 'capturing' && !connected ? 'A conexão com o servidor caiu. A captura continua ativa no agente.' : message;

  return (
    <Stack>
      <Group justify="space-between" wrap="wrap">
        <Group gap="sm">
          {effective === 'capturing' ? (
            <Button color="red" variant="light" leftSection={<IconPlayerStop size={16} />} onClick={stop}>
              Parar captura
            </Button>
          ) : (
            <Button
              leftSection={effective === 'stopped' ? <IconKeyboard size={16} /> : <IconPlayerPlay size={16} />}
              loading={effective === 'starting'}
              disabled={!connected}
              onClick={() => void start()}
            >
              {effective === 'stopped' ? 'Reiniciar captura' : 'Iniciar captura'}
            </Button>
          )}
          <SegmentedControl
            value={view}
            onChange={(v) => setView(v)}
            data={[
              { label: 'Ao vivo', value: 'live' },
              { label: 'Histórico', value: 'history' },
            ]}
          />
        </Group>
        <Badge color={effective === 'capturing' ? 'teal' : 'gray'} variant="light">
          {effective === 'capturing' ? 'Capturando' : effective === 'starting' ? 'Iniciando' : 'Inativo'}
        </Badge>
      </Group>

      {!connected && effective !== 'idle' && (
        <Alert color="blue" variant="light">
          Sem conexão em tempo real. A captura continua ativa no agente — reconecte para ver os dados ao vivo.
        </Alert>
      )}
      {effective === 'stopped' && shownMessage && (
        <Alert color="yellow" icon={<IconAlertTriangle size={18} />} title="Captura encerrada">
          {shownMessage}
        </Alert>
      )}

      {view === 'live' && <LiveView entries={liveEntries} status={effective} scrollRef={scrollRef} />}
      {view === 'history' && (
        <HistoryView
          agentId={agent.id}
          date={historyDate}
          onDateChange={setHistoryDate}
          sessions={sessionsQuery.data}
          loading={sessionsQuery.isLoading}
        />
      )}
    </Stack>
  );
}

function LiveView({
  entries,
  status,
  scrollRef,
}: {
  entries: LiveEntry[];
  status: Status;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <Paper withBorder p="md" bg="var(--mantine-color-dark-7, #1a1b1e)">
      <Text size="xs" c="dimmed" mb="xs">
        Teclas capturadas ao vivo ({entries.length} eventos)
      </Text>
      <ScrollArea h={420} ref={scrollRef}>
        {entries.length === 0 ? (
          <Text size="sm" c="dimmed" ta="center" py="xl">
            {status === 'capturing' ? 'Aguardando teclas digitadas no agente...' : 'Nenhuma tecla capturada. Inicie a captura.'}
          </Text>
        ) : (
          <Stack gap={4}>
            {entries.map((entry, i) => (
              <Group key={i} gap="xs" wrap="nowrap" align="flex-start">
                <Text size="xs" c="dimmed" style={{ flexShrink: 0, fontFamily: 'monospace' }}>
                  {entry.ts > 0 ? new Date(entry.ts).toLocaleTimeString('pt-BR') : '--:--:--'}
                </Text>
                <Code block style={{ flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {entry.keys}
                </Code>
              </Group>
            ))}
          </Stack>
        )}
      </ScrollArea>
    </Paper>
  );
}

function HistoryView({
  agentId,
  date,
  onDateChange,
  sessions,
  loading,
}: {
  agentId: number;
  date: string | null;
  onDateChange: (d: string | null) => void;
  sessions: KeyCaptureSessionDto[] | undefined;
  loading: boolean;
}) {
  return (
    <Stack>
      <Group>
        <DatePickerInput
          label="Data"
          value={date}
          onChange={(v) => onDateChange(v ?? null)}
          maxDate={new Date().toISOString().slice(0, 10)}
          valueFormat="DD/MM/YYYY"
          w={180}
        />
      </Group>
      {loading && <Loader size="sm" />}
      {!loading && sessions && sessions.length === 0 && (
        <Text size="sm" c="dimmed">
          Nenhuma captura registrada neste dia.
        </Text>
      )}
      {sessions && sessions.length > 0 && (
        <Accordion variant="contained">
          {sessions.map((s) => (
            <Accordion.Item key={s.id} value={String(s.id)}>
              <Accordion.Control>
                <Group gap="sm">
                  <Badge color={s.state === 'active' ? 'teal' : 'gray'} variant="light" size="sm">
                    {s.state === 'active' ? 'Ativa' : 'Encerrada'}
                  </Badge>
                  <Text size="sm">
                    {formatDateLabel(s.startedAt)} {formatTime(s.startedAt)}
                    {s.stoppedAt && ` — ${formatTime(s.stoppedAt)}`}
                  </Text>
                  <Text size="xs" c="dimmed">
                    por {s.username} · {s.entryCount} eventos
                  </Text>
                </Group>
              </Accordion.Control>
              <Accordion.Panel>
                <SessionEntries agentId={agentId} sessionId={s.id} />
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
      )}
    </Stack>
  );
}

function SessionEntries({ agentId, sessionId }: { agentId: number; sessionId: number }) {
  const query = useQuery({
    queryKey: ['keycapture-entries', agentId, sessionId],
    queryFn: () => keyCaptureApi.entries(agentId, sessionId),
  });

  if (query.isLoading) return <Loader size="sm" />;
  if (!query.data || query.data.length === 0) return <Text size="sm" c="dimmed">Sem entradas.</Text>;

  return (
    <ScrollArea h={300}>
      <Stack gap={4}>
        {query.data.map((entry, i) => (
          <Group key={i} gap="xs" wrap="nowrap" align="flex-start">
            <Text size="xs" c="dimmed" style={{ flexShrink: 0, fontFamily: 'monospace' }}>
              {formatTime(entry.capturedAt)}
            </Text>
            <Code block style={{ flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {entry.keys}
            </Code>
          </Group>
        ))}
      </Stack>
    </ScrollArea>
  );
}
