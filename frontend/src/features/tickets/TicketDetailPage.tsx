import { useState } from 'react';
import {
  ActionIcon,
  Anchor,
  Breadcrumbs,
  Button,
  Center,
  Grid,
  Group,
  Loader,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { IconPencil } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { ApiError } from '../../api/client';
import { queryKeys } from '../../api/queryKeys';
import { ticketQueuesApi, ticketsApi } from '../../api/tickets';
import { PERMISSIONS, type TicketDetail, type UpdateTicketRequest } from '../../api/types';
import { PATHS } from '../../app/paths';
import { hasPermission } from '../../auth/permissions';
import { useMe } from '../../auth/useMe';
import { NotFound } from '../../components/NotFound';
import { LoadError } from '../../components/TableStates';
import { formatDateTime } from '../../lib/format';
import { notifySuccess } from '../../lib/feedback';
import { AttachmentList } from './TicketAttachments';
import { SlaBreachedIcon, TicketPriorityBadge, TicketStatusBadge, TicketTypeBadge } from './TicketBadges';
import { TicketConversation } from './TicketConversation';
import { isTicketPriority, isTicketType, PRIORITY_OPTIONS, TICKET_SOURCE_LABEL, TYPE_OPTIONS } from './ticketFormat';
import { storeTicket } from './ticketActions';
import { TicketSidebar } from './TicketSidebar';

export function TicketDetailPage() {
  const { id: rawId } = useParams();
  const id = Number(rawId);
  const valid = Number.isInteger(id) && id > 0;
  const ticket = useQuery({ queryKey: queryKeys.ticketDetail(id), queryFn: () => ticketsApi.get(id), enabled: valid });

  if (!valid || (ticket.error instanceof ApiError && ticket.error.status === 404)) return <NotFound />;
  if (ticket.isError) return <LoadError error={ticket.error} onRetry={() => void ticket.refetch()} />;
  if (!ticket.data) {
    return (
      <Center py="xl">
        <Loader aria-label="Carregando chamado" />
      </Center>
    );
  }
  return <TicketDetailView ticket={ticket.data} />;
}

function TicketDetailView({ ticket }: { ticket: TicketDetail }) {
  const { data: me } = useMe();
  const canManage = hasPermission(me, PERMISSIONS.ticketsManage);

  return (
    <>
      <Breadcrumbs mb="xs">
        <Anchor component={Link} to={PATHS.tickets} size="sm">
          Chamados
        </Anchor>
        <Text size="sm">#{ticket.id}</Text>
      </Breadcrumbs>
      <Grid gap="lg">
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Stack>
            <TicketHeader ticket={ticket} canManage={canManage} />
            <Paper withBorder p="md" component="section" aria-labelledby="descricao-title">
              <Title order={4} id="descricao-title" mb="xs">
                Descrição
              </Title>
              {ticket.description ? (
                <Text size="sm" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {ticket.description}
                </Text>
              ) : (
                <Text size="sm" c="dimmed">
                  Sem descrição.
                </Text>
              )}
            </Paper>
            <TicketConversation ticketId={ticket.id} canManage={canManage} />
            <AttachmentsSection ticketId={ticket.id} />
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <TicketSidebar ticket={ticket} me={me} />
        </Grid.Col>
      </Grid>
    </>
  );
}

function TicketHeader({ ticket, canManage }: { ticket: TicketDetail; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(ticket.title);
  const queues = useQuery({ queryKey: queryKeys.ticketQueues, queryFn: ticketQueuesApi.list, enabled: canManage });

  const update = useMutation({
    mutationFn: (body: UpdateTicketRequest) => ticketsApi.update(ticket.id, body),
    onSuccess: (updated) => {
      notifySuccess('Chamado atualizado.');
      storeTicket(queryClient, updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.ticketMessages(ticket.id) });
      setEditingTitle(false);
    },
  });

  const trimmed = title.trim();
  const titleError = trimmed.length < 3 ? 'Use pelo menos 3 caracteres' : trimmed.length > 200 ? 'Use no máximo 200 caracteres' : undefined;
  const queueOptions = (queues.data ?? []).map((q) => ({ value: String(q.id), label: q.name }));
  if (!queueOptions.some((o) => o.value === String(ticket.queueId))) queueOptions.push({ value: String(ticket.queueId), label: ticket.queueName });

  return (
    <Paper withBorder p="md" component="header">
      <Group gap="xs" wrap="nowrap" align="flex-start">
        <Text fz="xl" fw={700} c="dimmed" ff="monospace" lh={1.4}>
          #{ticket.id}
        </Text>
        {editingTitle ? (
          <form
            style={{ flex: 1 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (!titleError) update.mutate({ title: trimmed });
            }}
          >
            <Group gap="xs" align="flex-start" wrap="nowrap">
              <TextInput
                aria-label="Título do chamado"
                value={title}
                onChange={(e) => setTitle(e.currentTarget.value)}
                error={titleError}
                maxLength={200}
                style={{ flex: 1 }}
                data-autofocus
              />
              <Button type="submit" loading={update.isPending} disabled={Boolean(titleError)}>
                Salvar
              </Button>
              <Button
                variant="default"
                onClick={() => {
                  setTitle(ticket.title);
                  setEditingTitle(false);
                }}
              >
                Cancelar
              </Button>
            </Group>
          </form>
        ) : (
          <Group gap="xs" wrap="nowrap" style={{ flex: 1 }} align="flex-start">
            <Title order={2} fz="xl" lh={1.4} style={{ wordBreak: 'break-word' }}>
              {ticket.title}
            </Title>
            {canManage && (
              <Tooltip label="Editar título">
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  aria-label="Editar título"
                  mt={4}
                  onClick={() => {
                    setTitle(ticket.title);
                    setEditingTitle(true);
                  }}
                >
                  <IconPencil size={16} />
                </ActionIcon>
              </Tooltip>
            )}
          </Group>
        )}
      </Group>

      <Group gap="xs" mt="sm">
        <TicketStatusBadge status={ticket.status} />
        {ticket.slaBreached && <SlaBreachedIcon />}
        {!canManage && (
          <>
            <TicketTypeBadge type={ticket.type} />
            <TicketPriorityBadge priority={ticket.priority} />
            <Text size="sm">Fila: {ticket.queueName}</Text>
          </>
        )}
      </Group>

      {canManage && (
        <Group gap="sm" mt="sm" grow>
          <Select
            label="Tipo"
            data={TYPE_OPTIONS}
            allowDeselect={false}
            value={ticket.type}
            disabled={update.isPending}
            onChange={(v) => {
              if (isTicketType(v) && v !== ticket.type) update.mutate({ type: v });
            }}
          />
          <Select
            label="Prioridade"
            data={PRIORITY_OPTIONS}
            allowDeselect={false}
            value={ticket.priority}
            disabled={update.isPending}
            onChange={(v) => {
              if (isTicketPriority(v) && v !== ticket.priority) update.mutate({ priority: v });
            }}
          />
          <Select
            label="Fila"
            data={queueOptions}
            allowDeselect={false}
            value={String(ticket.queueId)}
            disabled={update.isPending}
            onChange={(v) => {
              if (v && Number(v) !== ticket.queueId) update.mutate({ queueId: Number(v) });
            }}
          />
        </Group>
      )}

      <Text size="xs" c="dimmed" mt="sm">
        Aberto em {formatDateTime(ticket.createdAt)} · origem: {TICKET_SOURCE_LABEL[ticket.source]}
        {ticket.createdByName ? ` · por ${ticket.createdByName}` : ''} · atualizado em {formatDateTime(ticket.updatedAt)}
      </Text>
    </Paper>
  );
}

function AttachmentsSection({ ticketId }: { ticketId: number }) {
  const attachments = useQuery({ queryKey: queryKeys.ticketAttachments(ticketId), queryFn: () => ticketsApi.attachments(ticketId) });
  if (!attachments.data || attachments.data.length === 0) return null;
  return (
    <Paper withBorder p="md" component="section" aria-labelledby="anexos-title">
      <Title order={4} id="anexos-title" mb="xs">
        Anexos
      </Title>
      <AttachmentList ticketId={ticketId} attachments={attachments.data} />
    </Paper>
  );
}
