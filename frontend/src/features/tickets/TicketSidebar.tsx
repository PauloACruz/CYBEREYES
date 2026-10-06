import { useState } from 'react';
import { Anchor, Button, Group, Paper, Select, Stack, Text, Textarea, Title } from '@mantine/core';
import { IconAlertTriangle, IconUserCheck } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { queryKeys } from '../../api/queryKeys';
import { ticketsApi } from '../../api/tickets';
import { PERMISSIONS, type ChangeTicketStatusRequest, type MeDto, type TicketDetail } from '../../api/types';
import { agentPath, PATHS } from '../../app/paths';
import { hasPermission } from '../../auth/permissions';
import { formatDateTime } from '../../lib/format';
import { notifySuccess } from '../../lib/feedback';
import { AgentStatusBadge, OperatingSystem } from '../agents/agentDisplay';
import { RemoteAccessMenu } from '../agents/actions/RemoteAccessMenu';
import { RemoteSessionsCompact } from '../remote/RemoteSessionsTable';
import { TicketStatusBadge } from './TicketBadges';
import { isOverdue, isTicketStatus, STATUS_OPTIONS, TICKET_STATUS_INFO } from './ticketFormat';
import { storeTicket } from './ticketActions';
import { TimeEntriesPanel } from './TimeEntriesPanel';

const UNASSIGNED = 'sem-tecnico';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text size="sm" component="div" mt={2}>
        {children}
      </Text>
    </div>
  );
}

function orMissing(value: string | null | undefined): string {
  return value && value !== 'None' ? value : 'Não informado';
}

interface SidebarProps {
  ticket: TicketDetail;
  me: MeDto | undefined;
}

export function TicketSidebar({ ticket, me }: SidebarProps) {
  const canManage = hasPermission(me, PERMISSIONS.ticketsManage);
  return (
    <Stack>
      <StatusCard ticket={ticket} canManage={canManage} />
      <AssigneeCard ticket={ticket} canManage={canManage} me={me} />
      <SlaCard ticket={ticket} />
      <MachineCard ticket={ticket} me={me} />
      <RequesterCard ticket={ticket} />
      <TimeEntriesPanel ticketId={ticket.id} canManage={canManage} me={me} />
    </Stack>
  );
}

function StatusCard({ ticket, canManage }: { ticket: TicketDetail; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const change = useMutation({
    mutationFn: (body: ChangeTicketStatusRequest) => ticketsApi.setStatus(ticket.id, body),
    onSuccess: (updated) => {
      notifySuccess(`Status alterado para ${TICKET_STATUS_INFO[updated.status].label}.`);
      storeTicket(queryClient, updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.ticketMessages(ticket.id) });
      setPending(null);
      setMessage('');
    },
  });
  const target = isTicketStatus(pending) && pending !== ticket.status ? pending : null;

  return (
    <Paper withBorder p="md" component="section" aria-labelledby="status-title">
      <Title order={5} id="status-title" mb="xs">
        Status
      </Title>
      {canManage ? (
        <Stack gap="xs">
          <Select
            aria-label="Status do chamado"
            data={STATUS_OPTIONS}
            allowDeselect={false}
            value={target ?? ticket.status}
            onChange={setPending}
          />
          {target && (
            <>
              <Textarea
                label="Mensagem ao usuário"
                description="Opcional. Fica visível na conversa e no app de bandeja."
                autosize
                minRows={2}
                maxRows={6}
                value={message}
                onChange={(e) => setMessage(e.currentTarget.value)}
              />
              <Group justify="flex-end" gap="xs">
                <Button variant="default" size="xs" onClick={() => setPending(null)}>
                  Cancelar
                </Button>
                <Button
                  size="xs"
                  loading={change.isPending}
                  onClick={() => change.mutate(message.trim() ? { status: target, message: message.trim() } : { status: target })}
                >
                  Alterar status
                </Button>
              </Group>
            </>
          )}
        </Stack>
      ) : (
        <TicketStatusBadge status={ticket.status} size="md" />
      )}
      {ticket.resolvedAt && (
        <Text size="xs" c="dimmed" mt="xs">
          Resolvido em {formatDateTime(ticket.resolvedAt)}
        </Text>
      )}
      {ticket.closedAt && (
        <Text size="xs" c="dimmed" mt={2}>
          Fechado em {formatDateTime(ticket.closedAt)}
        </Text>
      )}
    </Paper>
  );
}

function AssigneeCard({ ticket, canManage, me }: { ticket: TicketDetail; canManage: boolean; me: MeDto | undefined }) {
  const queryClient = useQueryClient();
  const assignees = useQuery({ queryKey: queryKeys.ticketAssignees, queryFn: ticketsApi.assignees, enabled: canManage });
  const assign = useMutation({
    mutationFn: (userId: string | null) => ticketsApi.assign(ticket.id, userId),
    onSuccess: (updated) => {
      notifySuccess(updated.assignedToName ? `Chamado atribuído a ${updated.assignedToName}.` : 'Chamado sem técnico.');
      storeTicket(queryClient, updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.ticketMessages(ticket.id) });
    },
  });

  const options = [{ value: UNASSIGNED, label: 'Sem técnico' }, ...(assignees.data ?? []).map((u) => ({ value: u.id, label: u.name }))];
  if (ticket.assignedToId && !options.some((o) => o.value === ticket.assignedToId)) {
    options.push({ value: ticket.assignedToId, label: ticket.assignedToName ?? 'Técnico atual' });
  }
  const isMine = me !== undefined && ticket.assignedToId === me.id;

  return (
    <Paper withBorder p="md" component="section" aria-labelledby="tecnico-title">
      <Group justify="space-between" mb="xs">
        <Title order={5} id="tecnico-title">
          Técnico
        </Title>
        {canManage && !isMine && me && (
          <Button size="compact-sm" variant="light" leftSection={<IconUserCheck size={14} />} loading={assign.isPending} onClick={() => assign.mutate(me.id)}>
            Assumir
          </Button>
        )}
      </Group>
      {canManage ? (
        <Select
          aria-label="Técnico atribuído"
          data={options}
          allowDeselect={false}
          searchable
          value={ticket.assignedToId ?? UNASSIGNED}
          onChange={(v) => {
            const next = !v || v === UNASSIGNED ? null : v;
            if (next !== ticket.assignedToId) assign.mutate(next);
          }}
          disabled={assign.isPending}
        />
      ) : (
        <Text size="sm" c={ticket.assignedToName ? undefined : 'dimmed'}>
          {ticket.assignedToName ?? 'Sem técnico'}
        </Text>
      )}
    </Paper>
  );
}

function DueField({ label, due, doneAt, doneLabel }: { label: string; due: string | null; doneAt: string | null; doneLabel: string }) {
  if (doneAt) {
    return (
      <Field label={label}>
        <Text size="sm" c="teal">
          {doneLabel} {formatDateTime(doneAt)}
        </Text>
      </Field>
    );
  }
  if (!due) return <Field label={label}>Sem prazo</Field>;
  const overdue = isOverdue(due);
  return (
    <Field label={label}>
      <Group gap={4} wrap="nowrap">
        {overdue && <IconAlertTriangle size={14} color="var(--mantine-color-red-6)" aria-hidden />}
        <Text size="sm" c={overdue ? 'red' : undefined} fw={overdue ? 600 : undefined}>
          {overdue ? `Vencido em ${formatDateTime(due)}` : `Até ${formatDateTime(due)}`}
        </Text>
      </Group>
    </Field>
  );
}

function SlaCard({ ticket }: { ticket: TicketDetail }) {
  const finishedAt = ticket.resolvedAt ?? ticket.closedAt;
  return (
    <Paper withBorder p="md" component="section" aria-labelledby="sla-title">
      <Title order={5} id="sla-title" mb="xs">
        Prazos de SLA
      </Title>
      <Stack gap="xs">
        <DueField label="Primeira resposta" due={ticket.firstResponseDueAt} doneAt={ticket.firstResponseAt} doneLabel="Respondido em" />
        <DueField label="Solução" due={ticket.resolutionDueAt} doneAt={finishedAt} doneLabel="Solucionado em" />
      </Stack>
    </Paper>
  );
}

function MachineCard({ ticket, me }: { ticket: TicketDetail; me: MeDto | undefined }) {
  const agent = ticket.agent;
  const canViewAgents = hasPermission(me, PERMISSIONS.agentsView);
  const canRemote = hasPermission(me, PERMISSIONS.agentsRemote);
  const alertLink = ticket.agentId !== null && canViewAgents ? `${agentPath(ticket.agentId)}?aba=alertas` : PATHS.alerts;
  const canViewAlerts = hasPermission(me, PERMISSIONS.alertsView);

  return (
    <Paper withBorder p="md" component="section" aria-labelledby="maquina-title">
      <Title order={5} id="maquina-title" mb="xs">
        Máquina
      </Title>
      {!agent ? (
        <Text size="sm" c="dimmed">
          Chamado sem máquina vinculada.
        </Text>
      ) : (
        <Stack gap="xs">
          <Group justify="space-between" wrap="nowrap">
            {canViewAgents ? (
              <Anchor component={Link} to={agentPath(agent.id)} fw={600}>
                {agent.hostname}
              </Anchor>
            ) : (
              <Text fw={600}>{agent.hostname}</Text>
            )}
            <AgentStatusBadge status={agent.status} />
          </Group>
          {ticket.clientName && (
            <Text size="xs" c="dimmed">
              {ticket.clientName}
              {ticket.siteName ? ` / ${ticket.siteName}` : ''}
            </Text>
          )}
          <Field label="Sistema">
            <OperatingSystem plat={agent.plat} operatingSystem={agent.operatingSystem} />
          </Field>
          <Field label="Usuário logado">{orMissing(agent.loggedInUsername)}</Field>
          <Field label="IP público">{orMissing(agent.publicIp)}</Field>
          {canRemote && (
            <div>
              <RemoteAccessMenu agent={agent} ticketId={ticket.id} />
            </div>
          )}
          {canRemote && <RemoteSessionsCompact ticketId={ticket.id} />}
        </Stack>
      )}
      {ticket.alertId !== null && (
        <Group gap={6} mt="sm" wrap="nowrap">
          <IconAlertTriangle size={16} color="var(--mantine-color-red-6)" aria-hidden />
          {canViewAlerts ? (
            <Anchor component={Link} to={alertLink} size="sm">
              Ver alerta #{ticket.alertId} que gerou o incidente
            </Anchor>
          ) : (
            <Text size="sm">Gerado pelo alerta #{ticket.alertId}</Text>
          )}
        </Group>
      )}
    </Paper>
  );
}

function RequesterCard({ ticket }: { ticket: TicketDetail }) {
  return (
    <Paper withBorder p="md" component="section" aria-labelledby="solicitante-title">
      <Title order={5} id="solicitante-title" mb="xs">
        Solicitante
      </Title>
      <Stack gap="xs">
        <Field label="Nome">{ticket.requesterName}</Field>
        {ticket.requesterUsername && <Field label="Usuário do sistema">{ticket.requesterUsername}</Field>}
        {ticket.requesterEmail && (
          <Field label="E-mail">
            <Anchor href={`mailto:${ticket.requesterEmail}`} size="sm">
              {ticket.requesterEmail}
            </Anchor>
          </Field>
        )}
      </Stack>
    </Paper>
  );
}
