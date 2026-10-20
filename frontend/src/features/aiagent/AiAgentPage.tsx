import { useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Code,
  Grid,
  Group,
  Loader,
  NavLink,
  Paper,
  Select,
  Stack,
  Text,
  Textarea,
  Tooltip,
} from '@mantine/core';
import { IconAlertTriangle, IconCheck, IconPlus, IconRobot, IconSend, IconTool, IconX } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { consoleAgentApi } from '../../api/assistant';
import type { ConsoleActionStatus, ConsoleEntryDto, ConsoleExecutorDto, ConsoleSessionDto, ConsoleSessionStatus } from '../../api/types';
import { PageHeader } from '../../components/PageHeader';
import { LoadError } from '../../components/TableStates';
import { formatDateTime } from '../../lib/format';

const KEYS = {
  executors: ['console-agent', 'executors'],
  sessions: ['console-agent', 'sessions'],
  session: (id: string) => ['console-agent', 'session', id],
};

const MAX_MESSAGE = 8000;

const SESSION_STATUS: Record<ConsoleSessionStatus, { label: string; color: string }> = {
  running: { label: 'Trabalhando', color: 'blue' },
  awaiting_approval: { label: 'Esperando aprovação', color: 'yellow' },
  idle: { label: 'Concluída', color: 'teal' },
  failed: { label: 'Falhou', color: 'red' },
};

const ACTION_STATUS: Record<ConsoleActionStatus, { label: string; color: string }> = {
  running: { label: 'Executando', color: 'blue' },
  pending: { label: 'Esperando aprovação', color: 'yellow' },
  done: { label: 'Feita', color: 'teal' },
  error: { label: 'Erro', color: 'red' },
  rejected: { label: 'Recusada', color: 'gray' },
};

/** Menu Agente de IA: o técnico pede, o agente executa com as ferramentas da plataforma e pede aprovação para mexer nas máquinas. */
export function AiAgentPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selected = searchParams.get('conversa');
  const select = (id: string | null) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (id) next.set('conversa', id);
        else next.delete('conversa');
        return next;
      },
      { replace: true },
    );

  const executors = useQuery({ queryKey: KEYS.executors, queryFn: consoleAgentApi.executors });
  const sessions = useQuery({ queryKey: KEYS.sessions, queryFn: consoleAgentApi.sessions });

  return (
    <>
      <PageHeader
        title="Agente de IA"
        description="Peça ações ao agente de IA. Ele age com as suas permissões, limitadas às do agente, e a auditoria registra você como autor e o agente como executor."
        actions={
          selected && (
            <Button leftSection={<IconPlus size={16} />} variant="default" onClick={() => select(null)}>
              Nova conversa
            </Button>
          )
        }
      />
      {executors.isError && <LoadError error={executors.error} onRetry={() => void executors.refetch()} />}
      <Grid gap="md">
        <Grid.Col span={{ base: 12, md: 3 }}>
          <Paper withBorder p="xs">
            <Text size="xs" fw={600} c="dimmed" tt="uppercase" px="xs" pb={4}>
              Conversas
            </Text>
            {sessions.isPending && <Loader size="sm" m="xs" />}
            {sessions.data?.length === 0 && (
              <Text size="sm" c="dimmed" px="xs" py={4}>
                Nenhuma conversa ainda.
              </Text>
            )}
            <nav aria-label="Conversas com o agente">
              {sessions.data?.map((s) => (
                <NavLink
                  key={s.id}
                  active={s.id === selected}
                  onClick={() => select(s.id)}
                  label={<Text size="sm" lineClamp={2}>{s.title}</Text>}
                  description={`${s.executorName} · ${formatDateTime(s.updatedAt)}`}
                  rightSection={<Badge size="xs" variant="dot" color={SESSION_STATUS[s.status].color} />}
                />
              ))}
            </nav>
          </Paper>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 9 }}>
          {selected ? (
            <Conversation key={selected} id={selected} />
          ) : (
            <NewConversation executors={executors.data} loading={executors.isPending} onStarted={(id) => select(id)} />
          )}
        </Grid.Col>
      </Grid>
    </>
  );
}

function NewConversation({ executors, loading, onStarted }: { executors?: ConsoleExecutorDto[]; loading: boolean; onStarted: (id: string) => void }) {
  const queryClient = useQueryClient();
  const [executor, setExecutor] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const chosen = executors?.find((e) => e.id === executor) ?? executors?.[0];

  const start = useMutation({
    mutationFn: () => consoleAgentApi.start(chosen?.id ?? '', message.trim()),
    onSuccess: async (session) => {
      queryClient.setQueryData(KEYS.session(session.id), session);
      await queryClient.invalidateQueries({ queryKey: KEYS.sessions });
      onStarted(session.id);
    },
  });

  if (loading) return <Loader size="sm" />;
  if (!executors || executors.length === 0) {
    return (
      <Alert color="yellow" icon={<IconAlertTriangle size={18} />} title="Nenhum agente disponível">
        Ligue o agente nativo ou o agente da Anthropic e cadastre a chave da API em Configurações &gt; Assistente de IA.
      </Alert>
    );
  }
  return (
    <Paper withBorder p="md">
      <Stack gap="sm">
        <Select
          label="Agente"
          data={executors.map((e) => ({ value: e.id, label: e.id === 'native' ? `${e.name} (agente nativo)` : `${e.name} (Anthropic)` }))}
          value={chosen?.id ?? null}
          onChange={setExecutor}
          allowDeselect={false}
          maw={360}
        />
        {chosen && <PermissionSummary executor={chosen} />}
        <Textarea
          label="O que o agente deve fazer"
          placeholder="Ex.: veja os chamados abertos sem técnico do cliente Matriz e me diga quais são de impressora."
          autosize
          minRows={3}
          maxRows={10}
          value={message}
          onChange={(e) => setMessage(e.currentTarget.value)}
          error={message.length > MAX_MESSAGE ? `Use no máximo ${MAX_MESSAGE} caracteres` : undefined}
        />
        <Group justify="flex-end">
          <Button
            leftSection={<IconSend size={16} />}
            onClick={() => start.mutate()}
            loading={start.isPending}
            disabled={!chosen || !message.trim() || message.length > MAX_MESSAGE}
          >
            Enviar ao agente
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}

function PermissionSummary({ executor }: { executor: ConsoleExecutorDto }) {
  if (executor.permissions.length === 0) {
    return (
      <Text size="sm" c="red">
        {executor.name} não tem nenhuma permissão que você também tenha: ele só consegue conversar.
      </Text>
    );
  }
  return (
    <Tooltip label={executor.permissions.join(', ')} multiline maw={420} withArrow>
      <Text size="sm" c="dimmed" w="fit-content">
        Pode usar {executor.permissions.length} {executor.permissions.length === 1 ? 'permissão' : 'permissões'} (as dele que você também tem).
      </Text>
    </Tooltip>
  );
}

function Conversation({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const session = useQuery({
    queryKey: KEYS.session(id),
    queryFn: () => consoleAgentApi.session(id),
    // Enquanto o agente trabalha, a tela acompanha cada ação.
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 1500 : false),
  });

  const after = async (updated: ConsoleSessionDto) => {
    queryClient.setQueryData(KEYS.session(id), updated);
    await queryClient.invalidateQueries({ queryKey: KEYS.sessions });
  };
  const send = useMutation({
    mutationFn: () => consoleAgentApi.send(id, message.trim()),
    onSuccess: async (updated) => {
      setMessage('');
      await after(updated);
    },
  });
  const decide = useMutation({ mutationFn: (approve: boolean) => consoleAgentApi.approve(id, approve), onSuccess: after });

  if (session.isError) return <LoadError error={session.error} onRetry={() => void session.refetch()} />;
  const data = session.data;
  if (!data) return <Loader size="sm" />;
  const busy = data.status === 'running' || data.status === 'awaiting_approval';
  const pending = (data.entries ?? []).filter((e) => e.kind === 'action' && e.status === 'pending');

  return (
    <Stack gap="sm">
      <Group gap="xs">
        <IconRobot size={18} />
        <Text fw={600}>{data.executorName}</Text>
        <Badge variant="light" color={SESSION_STATUS[data.status].color}>
          {SESSION_STATUS[data.status].label}
        </Badge>
      </Group>
      <Stack gap="xs" aria-label="Conversa com o agente" role="log">
        {(data.entries ?? []).map((entry, index) => (
          <Entry key={index} entry={entry} agent={data.executorName} />
        ))}
      </Stack>
      {data.status === 'running' && (
        <Group gap="xs">
          <Loader size="xs" />
          <Text size="sm" c="dimmed">
            O agente está trabalhando…
          </Text>
        </Group>
      )}
      {data.status === 'awaiting_approval' && (
        <Alert color="yellow" icon={<IconAlertTriangle size={18} />} title="Aprovação necessária">
          <Text size="sm" mb="sm">
            O agente quer executar {pending.length === 1 ? 'uma ação que muda máquinas' : `${pending.length} ações que mudam máquinas`}:{' '}
            {pending.map((p) => p.tool).join(', ')}. Confira os argumentos acima antes de aprovar.
          </Text>
          <Group gap="xs">
            <Button color="green" leftSection={<IconCheck size={16} />} loading={decide.isPending && decide.variables} onClick={() => decide.mutate(true)}>
              Aprovar e executar
            </Button>
            <Button variant="default" leftSection={<IconX size={16} />} loading={decide.isPending && !decide.variables} onClick={() => decide.mutate(false)}>
              Recusar
            </Button>
          </Group>
        </Alert>
      )}
      {data.status === 'failed' && data.error && (
        <Alert color="red" icon={<IconAlertTriangle size={18} />} title="O agente parou">
          {data.error}
        </Alert>
      )}
      <Paper withBorder p="sm">
        <Stack gap="xs">
          <Textarea
            aria-label="Nova mensagem ao agente"
            placeholder={busy ? 'Espere o agente terminar ou responda à aprovação.' : 'Peça outra coisa ou continue a conversa'}
            autosize
            minRows={2}
            maxRows={8}
            value={message}
            disabled={busy}
            onChange={(e) => setMessage(e.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button
              leftSection={<IconSend size={16} />}
              onClick={() => send.mutate()}
              loading={send.isPending}
              disabled={busy || !message.trim() || message.length > MAX_MESSAGE}
            >
              Enviar
            </Button>
          </Group>
        </Stack>
      </Paper>
    </Stack>
  );
}

function Entry({ entry, agent }: { entry: ConsoleEntryDto; agent: string }) {
  if (entry.kind === 'request') {
    return (
      <Paper p="sm" radius="md" bg="var(--mantine-color-blue-light)" ml={{ base: 0, sm: 'xl' }}>
        <Text size="xs" c="dimmed" mb={2}>
          Você{entry.at ? ` · ${formatDateTime(entry.at)}` : ''}
        </Text>
        <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
          {entry.text}
        </Text>
      </Paper>
    );
  }
  if (entry.kind === 'reply') {
    return (
      <Paper p="sm" radius="md" withBorder mr={{ base: 0, sm: 'xl' }}>
        <Text size="xs" c="dimmed" mb={2}>
          {agent}
        </Text>
        <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
          {entry.text}
        </Text>
      </Paper>
    );
  }
  const status = ACTION_STATUS[entry.status ?? 'running'];
  return (
    <Paper p="xs" radius="md" withBorder mr={{ base: 0, sm: 'xl' }} bg="var(--mantine-color-default-hover)">
      <Group gap="xs" wrap="nowrap">
        <IconTool size={16} />
        <Text size="sm" fw={500} ff="monospace">
          {entry.tool}
        </Text>
        <Badge size="sm" variant="light" color={status.color}>
          {status.label}
        </Badge>
      </Group>
      {entry.input && entry.input !== '{}' && (
        <Code block mt={6} fz="xs">
          {entry.input}
        </Code>
      )}
      {entry.result && (
        <Box component="details" mt={6}>
          <Text component="summary" size="xs" c="dimmed" style={{ cursor: 'pointer' }}>
            Resultado
          </Text>
          <Code block mt={4} fz="xs" mah={240} style={{ overflow: 'auto' }}>
            {entry.result}
          </Code>
        </Box>
      )}
    </Paper>
  );
}
