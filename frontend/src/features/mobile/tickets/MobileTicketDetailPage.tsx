import { useEffect, useRef, type ReactNode } from 'react';
import { ActionIcon, Badge, Box, Button, Center, FileButton, Group, Loader, SegmentedControl, Stack, Text, Textarea } from '@mantine/core';
import { IconDeviceDesktop, IconDeviceDesktopShare, IconPaperclip, IconSend, IconUserCheck, IconX } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { ApiError } from '../../../api/client';
import { queryKeys } from '../../../api/queryKeys';
import { proceduresApi } from '../../../api/procedures';
import { ticketsApi } from '../../../api/tickets';
import { PERMISSIONS, type TicketDetail } from '../../../api/types';
import { MOBILE_PATHS, mobileAgentPath } from '../../../app/paths';
import { hasPermission } from '../../../auth/permissions';
import { useMe } from '../../../auth/useMe';
import { NotFound } from '../../../components/NotFound';
import { LoadError } from '../../../components/TableStates';
import { notifySuccess } from '../../../lib/feedback';
import { formatBytes, formatDateTime } from '../../../lib/format';
import { STATUS_INFO } from '../../agents/agentFormat';
import { openRemoteWindow } from '../../agents/actions/openRemoteWindow';
import { TicketPriorityBadge, TicketStatusBadge, TicketTypeBadge } from '../../tickets/TicketBadges';
import { MessageItem } from '../../tickets/TicketConversation';
import { AssigneeCard, StatusCard } from '../../tickets/TicketSidebar';
import { storeTicket } from '../../tickets/ticketActions';
import { REPLY_OPTIONS, useTicketRealtime, useTicketReply } from '../../tickets/ticketReply';
import { formatMinutes } from '../../tickets/ticketFormat';
import { procedureDuration } from '../../procedures/procedureFormat';
import { ProcedureKindBadge } from '../../procedures/ProceduresTable';
import { InfoRows, MobileHeader, MobilePage, MobileSection } from '../MobilePage';
import { MOBILE_CARD } from '../mobileStyles';

export function MobileTicketDetailPage() {
  const { id: rawId } = useParams();
  const id = Number(rawId);
  const valid = Number.isInteger(id) && id > 0;
  const ticket = useQuery({ queryKey: queryKeys.ticketDetail(id), queryFn: () => ticketsApi.get(id), enabled: valid });
  const header = <MobileHeader title={valid ? `#${id}` : 'Chamado'} back={{ to: MOBILE_PATHS.tickets, label: 'Chamados' }} />;

  if (!valid || (ticket.error instanceof ApiError && ticket.error.status === 404)) {
    return (
      <MobilePage header={header}>
        <NotFound />
      </MobilePage>
    );
  }
  if (ticket.isError) {
    return (
      <MobilePage header={header}>
        <LoadError error={ticket.error} onRetry={() => void ticket.refetch()} />
      </MobilePage>
    );
  }
  if (!ticket.data) {
    return (
      <MobilePage header={header}>
        <Center py="xl">
          <Loader aria-label="Carregando chamado" />
        </Center>
      </MobilePage>
    );
  }
  return <TicketView ticket={ticket.data} header={header} />;
}

function TicketView({ ticket, header }: { ticket: TicketDetail; header: ReactNode }) {
  useTicketRealtime(ticket.id);
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const canManage = hasPermission(me, PERMISSIONS.ticketsManage);
  const canRemote = hasPermission(me, PERMISSIONS.agentsRemote);
  const canAgents = hasPermission(me, PERMISSIONS.agentsView);
  const messages = useQuery({ queryKey: queryKeys.ticketMessages(ticket.id), queryFn: () => ticketsApi.messages(ticket.id) });
  const isMine = me !== undefined && ticket.assignedToId === me.id;
  const assume = useMutation({
    mutationFn: (userId: string) => ticketsApi.assign(ticket.id, userId),
    onSuccess: (updated) => {
      notifySuccess('Chamado atribuído a você.');
      storeTicket(queryClient, updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.ticketMessages(ticket.id) });
    },
  });
  const agent = ticket.agent;
  const agentStatus = agent ? STATUS_INFO[agent.status] : null;
  const due = ticket.resolutionDueAt;

  return (
    <MobilePage header={header} bottom={canManage ? <ReplyBar ticketId={ticket.id} /> : 'tabs'}>
      <Stack gap={8}>
        <Text component="h2" m={0} fz={22} fw={600} lh="28px">
          {ticket.title}
        </Text>
        <Group gap={6}>
          <TicketStatusBadge status={ticket.status} />
          <TicketPriorityBadge priority={ticket.priority} />
          <TicketTypeBadge type={ticket.type} />
          <Badge variant="light" color="gray">
            {ticket.queueName}
          </Badge>
        </Group>
        <Text size="sm" c="var(--ce-text-secondary)">
          Aberto em {formatDateTime(ticket.createdAt)} · por {ticket.createdByName ?? ticket.requesterName}
        </Text>
      </Stack>

      <Group gap={8} wrap="nowrap" mx={-16} px={16} style={{ overflowX: 'auto', scrollbarWidth: 'none' }}>
        {canManage && !isMine && me && (
          <Button variant="light" leftSection={<IconUserCheck size={18} />} loading={assume.isPending} onClick={() => assume.mutate(me.id)} style={{ flexShrink: 0 }}>
            Assumir
          </Button>
        )}
        {agent && canRemote && (
          <Button
            variant="default"
            leftSection={<IconDeviceDesktopShare size={18} />}
            disabled={agent.status !== 'online'}
            onClick={() => openRemoteWindow(agent.id, { ticketId: ticket.id })}
            style={{ flexShrink: 0 }}
          >
            Acesso remoto
          </Button>
        )}
        {agent && canAgents && (
          <Button component={Link} to={mobileAgentPath(agent.id)} variant="default" leftSection={<IconDeviceDesktop size={18} />} style={{ flexShrink: 0 }}>
            Abrir máquina
          </Button>
        )}
      </Group>

      <InfoRows
        rows={[
          {
            label: 'Máquina',
            value: agent ? (
              <Group gap={6} wrap="nowrap" justify="flex-end" component="span">
                <Box component="span" w={8} h={8} style={{ borderRadius: '50%', background: `var(--mantine-color-${agentStatus?.color ?? 'gray'}-6)` }} aria-hidden />
                <Text span ff="monospace" size="sm">
                  {agent.hostname}
                </Text>
                <Text span size="xs" c="var(--ce-text-secondary)">
                  {agentStatus?.label}
                </Text>
              </Group>
            ) : (
              'Sem máquina'
            ),
          },
          { label: 'Cliente', value: [ticket.clientName, ticket.siteName].filter(Boolean).join(' / ') || 'Não informado' },
          { label: 'Solicitante', value: ticket.requesterName },
          { label: 'Técnico', value: ticket.assignedToName ?? 'Sem técnico' },
          {
            label: 'Solução até',
            value: due ? (
              <Text span size="sm" c={ticket.slaBreached ? 'red' : undefined} fw={ticket.slaBreached ? 600 : undefined}>
                {formatDateTime(due)}
                {ticket.slaBreached ? ' · estourado' : ''}
              </Text>
            ) : (
              'Sem prazo'
            ),
          },
        ]}
      />

      {canManage && (
        <MobileSection title="Status e técnico">
          <StatusCard ticket={ticket} canManage />
          <AssigneeCard ticket={ticket} canManage me={me} showAssume={false} />
        </MobileSection>
      )}

      <TicketProcedures ticketId={ticket.id} />

      <MobileSection title="Descrição">
        <Text size="md" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }} c={ticket.description ? undefined : 'var(--ce-text-secondary)'}>
          {ticket.description || 'Sem descrição.'}
        </Text>
      </MobileSection>

      <MobileSection title="Conversa">
        {messages.isError && <LoadError error={messages.error} onRetry={() => void messages.refetch()} />}
        {messages.isPending && (
          <Center py="md">
            <Loader size="sm" aria-label="Carregando conversa" />
          </Center>
        )}
        {messages.isSuccess &&
          (messages.data.length === 0 ? (
            <Text size="sm" c="var(--ce-text-secondary)">
              Nenhuma mensagem ainda.
            </Text>
          ) : (
            <Stack gap="sm" role="log" aria-label="Mensagens do chamado" aria-live="polite">
              {messages.data.map((m) => (
                <MessageItem key={m.id} message={m} />
              ))}
            </Stack>
          ))}
      </MobileSection>
    </MobilePage>
  );
}

/** Resposta fixa no rodape: alterna entre resposta ao usuario e nota interna. */
function ReplyBar({ ticketId }: { ticketId: number }) {
  const { mode, setMode, body, setBody, files, addFiles, removeFile, internal, send, tooLong, canSend } = useTicketReply(ticketId);
  const sent = useRef(0);
  // Depois de enviar, a conversa nova fica visivel no fim da pagina.
  useEffect(() => {
    if (send.isSuccess && sent.current !== send.submittedAt) {
      sent.current = send.submittedAt;
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    }
  }, [send.isSuccess, send.submittedAt]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) send.mutate();
      }}
    >
      <Stack gap={8}>
        <SegmentedControl
          aria-label="Tipo de resposta"
          data={REPLY_OPTIONS}
          value={mode}
          onChange={(v) => setMode(v === 'internal' ? 'internal' : 'public')}
          color={internal ? 'yellow' : undefined}
          fullWidth
        />
        {files.length > 0 && (
          <Group gap="xs" aria-label="Arquivos a enviar">
            {files.map((file, index) => (
              <Badge
                key={`${file.name}-${index}`}
                variant="light"
                color="gray"
                rightSection={
                  <ActionIcon size="xs" variant="transparent" color="gray" aria-label={`Remover ${file.name}`} onClick={() => removeFile(index)}>
                    <IconX size={12} />
                  </ActionIcon>
                }
              >
                {file.name} ({formatBytes(file.size)})
              </Badge>
            ))}
          </Group>
        )}
        <Group gap={8} wrap="nowrap" align="flex-end">
          <FileButton onChange={addFiles} multiple>
            {(props) => (
              <ActionIcon {...props} variant="subtle" color="gray" size={44} aria-label="Anexar arquivos (até 10 MB cada)">
                <IconPaperclip size={22} />
              </ActionIcon>
            )}
          </FileButton>
          <Textarea
            aria-label={internal ? 'Nota interna' : 'Resposta ao usuário'}
            placeholder={internal ? 'Visível somente para os técnicos no console.' : 'O usuário recebe esta resposta no app de bandeja.'}
            autosize
            minRows={1}
            maxRows={5}
            size="md"
            value={body}
            onChange={(e) => setBody(e.currentTarget.value)}
            error={tooLong ? 'Use no máximo 20000 caracteres' : undefined}
            styles={internal ? { input: { backgroundColor: 'var(--mantine-color-yellow-light)' } } : undefined}
            style={{ flex: 1 }}
          />
          <ActionIcon
            type="submit"
            size={44}
            radius="xl"
            variant="filled"
            color={internal ? 'yellow' : undefined}
            loading={send.isPending}
            disabled={!canSend}
            aria-label={internal ? 'Salvar nota' : 'Enviar resposta'}
          >
            <IconSend size={20} />
          </ActionIcon>
        </Group>
      </Stack>
    </form>
  );
}

/** Procedimentos no agente incluidos no chamado (acesso remoto aberto por ele entra sozinho), com o tempo de servico. */
function TicketProcedures({ ticketId }: { ticketId: number }) {
  const procedures = useQuery({ queryKey: queryKeys.ticketProcedures(ticketId), queryFn: () => proceduresApi.forTicket(ticketId) });
  const items = procedures.data ?? [];
  if (items.length === 0) return null;
  const service = items.reduce((sum, p) => sum + (p.serviceMinutes ?? 0), 0);
  return (
    <MobileSection title={`Procedimentos (${formatMinutes(service)})`}>
      <Box style={MOBILE_CARD}>
        {items.map((p, index) => (
          <Stack key={p.id} gap={4} px={16} py={10} style={index > 0 ? { borderTop: '1px solid var(--ce-border-subtle)' } : undefined}>
            <Group gap={6} wrap="nowrap" justify="space-between">
              <ProcedureKindBadge procedure={p} />
              <Text size="sm" fw={600}>
                {p.serviceMinutes !== null ? formatMinutes(p.serviceMinutes) : ''}
              </Text>
            </Group>
            {p.title && <Text size="sm">{p.title}</Text>}
            <Text size="xs" c="var(--ce-text-secondary)">
              {p.hostname} · {formatDateTime(p.startedAt, '')} · {p.userName} · durou {procedureDuration(p)}
            </Text>
          </Stack>
        ))}
      </Box>
    </MobileSection>
  );
}
