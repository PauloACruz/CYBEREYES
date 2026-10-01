import { useEffect, useRef, useState } from 'react';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Center,
  FileButton,
  Group,
  Loader,
  Paper,
  SegmentedControl,
  Stack,
  Text,
  Textarea,
  Title,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconLock, IconPaperclip, IconSend, IconX } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import { ticketsApi } from '../../api/tickets';
import type { TicketMessageDto } from '../../api/types';
import { LoadError } from '../../components/TableStates';
import { formatBytes, formatDateTime } from '../../lib/format';
import { useConsoleHubConnection } from '../../realtime/consoleHubContext';
import { appendTicketMessage } from '../../realtime/ticketCache';
import { AttachmentList } from './TicketAttachments';
import { MAX_ATTACHMENT_BYTES, refreshTicketDetail } from './ticketActions';

type ReplyMode = 'public' | 'internal';

const REPLY_OPTIONS: { value: ReplyMode; label: string }[] = [
  { value: 'public', label: 'Resposta ao usuário' },
  { value: 'internal', label: 'Nota interna' },
];

/** Entra no grupo do chamado no hub e acrescenta as mensagens recebidas em tempo real. */
function useTicketRealtime(ticketId: number) {
  const queryClient = useQueryClient();
  const { connection, connected } = useConsoleHubConnection();

  useEffect(() => {
    if (!connection) return;
    const onMessage = (eventTicketId: number, message: TicketMessageDto) => {
      if (eventTicketId === ticketId) appendTicketMessage(queryClient, ticketId, message);
    };
    connection.on('ticketMessage', onMessage);
    return () => connection.off('ticketMessage', onMessage);
  }, [connection, ticketId, queryClient]);

  useEffect(() => {
    if (!connection || !connected) return;
    connection.invoke('JoinTicket', ticketId).catch(() => undefined);
    return () => {
      connection.invoke('LeaveTicket', ticketId).catch(() => undefined);
    };
  }, [connection, connected, ticketId]);
}

function MessageItem({ message }: { message: TicketMessageDto }) {
  if (message.authorType === 'system') {
    return (
      <Box ta="center" py={4} data-author="system">
        <Text size="xs" c="dimmed">
          {message.body} · {formatDateTime(message.createdAt)}
        </Text>
      </Box>
    );
  }
  const technician = message.authorType === 'technician';
  const background = message.internal
    ? 'var(--mantine-color-yellow-light)'
    : technician
      ? 'var(--mantine-color-blue-light)'
      : 'var(--mantine-color-default-hover)';
  return (
    <Group justify={technician ? 'flex-end' : 'flex-start'} data-author={message.authorType}>
      <Paper
        p="sm"
        radius="md"
        maw="85%"
        bg={background}
        withBorder={message.internal}
        style={message.internal ? { borderColor: 'var(--mantine-color-yellow-filled)' } : undefined}
        aria-label={message.internal ? `Nota interna de ${message.authorName}` : `Mensagem de ${message.authorName}`}
        component="article"
      >
        <Group gap="xs" mb={4} wrap="wrap">
          <Text size="sm" fw={600}>
            {message.authorName}
          </Text>
          {!technician && (
            <Badge size="xs" variant="light" color="gray">
              Usuário
            </Badge>
          )}
          {message.internal && (
            <Badge size="xs" color="yellow" variant="filled" leftSection={<IconLock size={10} aria-hidden />}>
              Nota interna
            </Badge>
          )}
          <Text size="xs" c="dimmed">
            {formatDateTime(message.createdAt)}
          </Text>
        </Group>
        <Text size="sm" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {message.body}
        </Text>
        {message.attachments.length > 0 && (
          <Box mt="xs">
            <AttachmentList ticketId={message.ticketId} attachments={message.attachments} />
          </Box>
        )}
      </Paper>
    </Group>
  );
}

export function TicketConversation({ ticketId, canManage }: { ticketId: number; canManage: boolean }) {
  useTicketRealtime(ticketId);
  const messages = useQuery({ queryKey: queryKeys.ticketMessages(ticketId), queryFn: () => ticketsApi.messages(ticketId) });
  const viewport = useRef<HTMLDivElement>(null);
  const count = messages.data?.length ?? 0;

  useEffect(() => {
    const el = viewport.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);

  return (
    <Paper withBorder p="md" component="section" aria-labelledby="conversa-title">
      <Title order={4} id="conversa-title" mb="sm">
        Conversa
      </Title>
      {messages.isError && <LoadError error={messages.error} onRetry={() => void messages.refetch()} />}
      {messages.isPending && (
        <Center py="lg">
          <Loader size="sm" aria-label="Carregando conversa" />
        </Center>
      )}
      {messages.isSuccess && (
        <Box ref={viewport} mah={560} style={{ overflowY: 'auto' }} role="log" aria-label="Mensagens do chamado" aria-live="polite">
          {count === 0 ? (
            <Text size="sm" c="dimmed" ta="center" py="md">
              Nenhuma mensagem ainda.
            </Text>
          ) : (
            <Stack gap="sm" pr={4}>
              {messages.data.map((m) => (
                <MessageItem key={m.id} message={m} />
              ))}
            </Stack>
          )}
        </Box>
      )}
      {canManage && <ReplyForm ticketId={ticketId} />}
    </Paper>
  );
}

function ReplyForm({ ticketId }: { ticketId: number }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<ReplyMode>('public');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const internal = mode === 'internal';

  const send = useMutation({
    mutationFn: async () => {
      const text = body.trim();
      let message: TicketMessageDto | undefined;
      if (text) {
        message = await ticketsApi.sendMessage(ticketId, { body: text, internal });
        appendTicketMessage(queryClient, ticketId, message);
      }
      for (const file of files) {
        await ticketsApi.upload(ticketId, file, message ? { messageId: message.id } : { internal });
      }
      return { message, uploaded: files.length };
    },
    onSuccess: ({ uploaded }) => {
      setBody('');
      setFiles([]);
      if (uploaded > 0) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.ticketMessages(ticketId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.ticketAttachments(ticketId) });
      }
      refreshTicketDetail(queryClient, ticketId);
    },
    onError: () => {
      // Mensagem ja gravada antes de um anexo falhar: recarregar para refletir o estado real.
      void queryClient.invalidateQueries({ queryKey: queryKeys.ticketMessages(ticketId) });
    },
  });

  const addFiles = (picked: File[]) => {
    const tooBig = picked.filter((f) => f.size > MAX_ATTACHMENT_BYTES);
    if (tooBig.length > 0) {
      notifications.show({
        color: 'red',
        title: 'Arquivo muito grande',
        message: `${tooBig.map((f) => f.name).join(', ')}: o limite é de 10 MB por arquivo.`,
      });
    }
    const accepted = picked.filter((f) => f.size <= MAX_ATTACHMENT_BYTES);
    if (accepted.length > 0) setFiles((prev) => [...prev, ...accepted]);
  };

  const tooLong = body.length > 20000;
  const canSend = (body.trim().length > 0 || files.length > 0) && !tooLong;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) send.mutate();
      }}
    >
      <Stack gap="xs" mt="md" pt="md" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
        <SegmentedControl
          aria-label="Tipo de resposta"
          data={REPLY_OPTIONS}
          value={mode}
          onChange={(v) => setMode(v === 'internal' ? 'internal' : 'public')}
          color={internal ? 'yellow' : undefined}
          w="fit-content"
        />
        <Textarea
          aria-label={internal ? 'Nota interna' : 'Resposta ao usuário'}
          placeholder={internal ? 'Visível somente para os técnicos no console.' : 'O usuário recebe esta resposta no app de bandeja.'}
          autosize
          minRows={3}
          maxRows={10}
          value={body}
          onChange={(e) => setBody(e.currentTarget.value)}
          error={tooLong ? 'Use no máximo 20000 caracteres' : undefined}
          styles={internal ? { input: { backgroundColor: 'var(--mantine-color-yellow-light)' } } : undefined}
        />
        {files.length > 0 && (
          <Group gap="xs" aria-label="Arquivos a enviar">
            {files.map((file, index) => (
              <Badge
                key={`${file.name}-${index}`}
                variant="light"
                color="gray"
                rightSection={
                  <ActionIcon
                    size="xs"
                    variant="transparent"
                    color="gray"
                    aria-label={`Remover ${file.name}`}
                    onClick={() => setFiles((prev) => prev.filter((_, i) => i !== index))}
                  >
                    <IconX size={12} />
                  </ActionIcon>
                }
              >
                {file.name} ({formatBytes(file.size)})
              </Badge>
            ))}
          </Group>
        )}
        <Group justify="space-between">
          <FileButton onChange={addFiles} multiple>
            {(props) => (
              <Tooltip label="Até 10 MB por arquivo">
                <Button {...props} variant="default" leftSection={<IconPaperclip size={16} />}>
                  Anexar arquivos
                </Button>
              </Tooltip>
            )}
          </FileButton>
          <Button type="submit" color={internal ? 'yellow' : undefined} leftSection={<IconSend size={16} />} loading={send.isPending} disabled={!canSend}>
            {internal ? 'Salvar nota' : 'Enviar resposta'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
