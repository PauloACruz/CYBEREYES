import { useState, type ReactNode } from 'react';
import { ActionIcon, Anchor, Badge, Box, Center, Group, Loader, SimpleGrid, Stack, Text, UnstyledButton } from '@mantine/core';
import {
  IconAlertTriangle,
  IconDeviceDesktopShare,
  IconDotsVertical,
  IconFolders,
  IconHeartRateMonitor,
  IconPower,
  IconPrompt,
  IconRefresh,
  IconRefreshAlert,
} from '@tabler/icons-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { agentActionsApi } from '../../../api/agentActions';
import { agentsApi } from '../../../api/agents';
import { alertsApi } from '../../../api/alerts';
import { careApi } from '../../../api/care';
import { ApiError } from '../../../api/client';
import { queryKeys } from '../../../api/queryKeys';
import { ticketsApi } from '../../../api/tickets';
import { PERMISSIONS, type AgentDetail, type ListAlertsParams } from '../../../api/types';
import { agentPath, MOBILE_PATHS, mobileCarePath, mobileCommandPath, mobileTicketPath } from '../../../app/paths';
import { hasPermission } from '../../../auth/permissions';
import { useMe } from '../../../auth/useMe';
import { NotFound } from '../../../components/NotFound';
import { LoadError } from '../../../components/TableStates';
import { confirmAction, notifySuccess } from '../../../lib/feedback';
import { formatDateTime, formatRelative } from '../../../lib/format';
import { AgentStatusBadge } from '../../agents/agentDisplay';
import { loggedUser } from '../../agents/agentFormat';
import { ShutdownModal } from '../../agents/actions/AgentActionsMenu';
import { openRemoteWindow } from '../../agents/actions/openRemoteWindow';
import { CARE_NAME, HEALTH_GRADE_INFO } from '../../care/careFormat';
import { SeverityBadge } from '../../monitoring/MonitoringBadges';
import { TicketStatusBadge } from '../../tickets/TicketBadges';
import { HealthRing } from '../MobileHealth';
import { InfoRows, MobileHeader, MobilePage, MobileSection } from '../MobilePage';
import { MOBILE_CARD } from '../mobileStyles';
import { MobileAgentActions } from './MobileAgentActions';

const OPEN_STATUSES = new Set(['new', 'in_progress', 'waiting_user']);

export function MobileAgentDetailPage() {
  const { id: rawId } = useParams();
  const id = Number(rawId);
  const valid = Number.isInteger(id) && id > 0;
  const agent = useQuery({ queryKey: queryKeys.agentDetail(id), queryFn: () => agentsApi.get(id), enabled: valid, refetchInterval: 60_000 });
  const back = { to: MOBILE_PATHS.agents, label: 'Agentes' };

  if (!valid || (agent.error instanceof ApiError && agent.error.status === 404)) {
    return (
      <MobilePage header={<MobileHeader title="Agente" back={back} />}>
        <NotFound />
      </MobilePage>
    );
  }
  if (agent.isError) {
    return (
      <MobilePage header={<MobileHeader title="Agente" back={back} />}>
        <LoadError error={agent.error} onRetry={() => void agent.refetch()} />
      </MobilePage>
    );
  }
  if (!agent.data) {
    return (
      <MobilePage header={<MobileHeader title="Agente" back={back} />}>
        <Center py="xl">
          <Loader aria-label="Carregando agente" />
        </Center>
      </MobilePage>
    );
  }
  return <AgentView agent={agent.data} />;
}

interface TileProps {
  icon: ReactNode;
  label: string;
  to?: string;
  onClick?: () => void;
  disabled?: boolean;
  accent?: boolean;
  danger?: boolean;
}

function Tile({ icon, label, to, onClick, disabled = false, accent = false, danger = false }: TileProps) {
  const color = disabled ? 'var(--ce-text-tertiary)' : accent ? 'var(--ce-accent-text)' : danger ? 'var(--mantine-color-red-6)' : 'var(--ce-text-primary)';
  const style = {
    ...MOBILE_CARD,
    ...(accent && !disabled ? { backgroundColor: 'var(--ce-accent-soft)' } : {}),
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 84,
    padding: 8,
    color,
    opacity: disabled ? 0.6 : 1,
    textAlign: 'center' as const,
    textDecoration: 'none',
  };
  const content = (
    <>
      {icon}
      <Text size="sm" fw={600} c="inherit" lh="18px">
        {label}
      </Text>
    </>
  );
  if (to && !disabled) {
    return (
      <UnstyledButton component={Link} to={to} style={style}>
        {content}
      </UnstyledButton>
    );
  }
  return (
    <UnstyledButton onClick={onClick} disabled={disabled} style={style}>
      {content}
    </UnstyledButton>
  );
}

function AgentView({ agent }: { agent: AgentDetail }) {
  const { data: me } = useMe();
  const [actions, setActions] = useState(false);
  const [shutdownOpen, setShutdownOpen] = useState(false);
  const reboot = useMutation({
    mutationFn: () => agentActionsApi.reboot(agent.id),
    onSuccess: () => notifySuccess(`Pedido de reinício enviado para ${agent.hostname}.`),
  });
  const online = agent.status === 'online';
  const canRun = hasPermission(me, PERMISSIONS.agentsRun);
  const canRemote = hasPermission(me, PERMISSIONS.agentsRemote);
  const canFiles = hasPermission(me, PERMISSIONS.agentsFiles);
  const canControl = hasPermission(me, PERMISSIONS.agentsControl);
  const canAlerts = hasPermission(me, PERMISSIONS.alertsView);
  const canTickets = hasPermission(me, PERMISSIONS.ticketsView);

  const health = useQuery({ queryKey: queryKeys.agentHealth(agent.id), queryFn: () => careApi.health(agent.id, { silent: true }), retry: false });
  const alertParams: ListAlertsParams = { status: 'active', agentId: agent.id, page: 1, pageSize: 5 };
  const alerts = useQuery({ queryKey: queryKeys.alertList(alertParams), queryFn: () => alertsApi.list(alertParams), enabled: canAlerts });
  const tickets = useQuery({ queryKey: queryKeys.agentTickets(agent.id), queryFn: () => ticketsApi.forAgent(agent.id), enabled: canTickets });
  const openTickets = (tickets.data ?? []).filter((t) => OPEN_STATUSES.has(t.status));
  const attention = (health.data?.items ?? []).filter((i) => i.status === 'warning' || i.status === 'critical');
  const ref = { id: agent.id, hostname: agent.hostname, status: agent.status, plat: agent.plat, clientName: agent.clientName, siteName: agent.siteName };

  return (
    <MobilePage
      header={
        <MobileHeader
          title={agent.hostname}
          mono
          back={{ to: MOBILE_PATHS.agents, label: 'Agentes' }}
          actions={
            <ActionIcon variant="subtle" color="gray" size={44} aria-label={`Ações de ${agent.hostname}`} onClick={() => setActions(true)}>
              <IconDotsVertical size={22} />
            </ActionIcon>
          }
        />
      }
    >
      <Stack gap="sm" p={16} style={MOBILE_CARD} component="section" aria-label="Situação">
        <Group gap={8}>
          <AgentStatusBadge status={agent.status} />
          {agent.needsReboot && (
            <Badge color="yellow" variant="light" leftSection={<IconRefreshAlert size={12} aria-hidden />}>
              Reinício pendente
            </Badge>
          )}
          <Text size="sm" c="var(--ce-text-secondary)">
            visto {formatRelative(agent.lastSeen)}
          </Text>
        </Group>
        {health.data ? (
          <Group gap="md" wrap="nowrap">
            <HealthRing score={health.data.score} grade={health.data.grade} size={88} />
            <Stack gap={4} style={{ minWidth: 0 }}>
              <Text size="xs" fw={600} tt="uppercase" c="var(--ce-text-secondary)" style={{ letterSpacing: '0.08em' }}>
                Saúde
              </Text>
              <Text fz={18} fw={600} c={HEALTH_GRADE_INFO[health.data.grade].color}>
                {HEALTH_GRADE_INFO[health.data.grade].label}
              </Text>
              <Text size="sm" c="var(--ce-text-secondary)">
                {attention.length === 0
                  ? 'Nenhum item em atenção.'
                  : attention.length === 1
                    ? `1 item em atenção: ${attention[0]?.label ?? ''}`
                    : `${attention.length} itens em atenção`}
              </Text>
              <Anchor component={Link} to={mobileCarePath(agent.id)} fw={600} size="sm">
                Ver saúde
              </Anchor>
            </Stack>
          </Group>
        ) : health.isPending ? null : (
          <Text size="sm" c="var(--ce-text-secondary)">
            O Health Check ainda não rodou nesta máquina.{' '}
            <Anchor component={Link} to={mobileCarePath(agent.id)} size="sm">
              Abrir o {CARE_NAME}
            </Anchor>
          </Text>
        )}
      </Stack>

      <SimpleGrid cols={3} spacing={8}>
        <Tile icon={<IconHeartRateMonitor size={24} />} label={CARE_NAME} to={mobileCarePath(agent.id)} accent />
        {canRun && <Tile icon={<IconPrompt size={24} />} label="Enviar comando" to={mobileCommandPath(agent.id)} />}
        {canRemote && <Tile icon={<IconDeviceDesktopShare size={24} />} label="Acesso remoto" disabled={!online} onClick={() => openRemoteWindow(agent.id)} />}
        {canFiles && <Tile icon={<IconFolders size={24} />} label="Arquivos" disabled={!online} to={`${agentPath(agent.id)}?aba=arquivos`} />}
        {canControl && (
          <Tile
            icon={<IconRefresh size={24} />}
            label="Reiniciar"
            disabled={!online}
            onClick={() =>
              confirmAction({
                title: 'Reiniciar máquina',
                message: `Reiniciar ${agent.hostname} agora? O usuário logado pode perder trabalho não salvo.`,
                confirmLabel: 'Reiniciar',
                danger: true,
                onConfirm: () => reboot.mutate(),
              })
            }
          />
        )}
        {canControl && <Tile icon={<IconPower size={24} />} label="Desligar" danger disabled={!online} onClick={() => setShutdownOpen(true)} />}
      </SimpleGrid>

      {canAlerts && (alerts.data?.total ?? 0) > 0 && (
        <MobileSection title={`Alertas ativos (${alerts.data?.total ?? 0})`}>
          <Stack gap={8}>
            {alerts.data?.items.map((alert) => (
              <Group key={alert.id} gap={12} wrap="nowrap" p="12px 16px" style={MOBILE_CARD}>
                <Box c={alert.severity === 'error' ? 'red' : 'orange'} display="flex">
                  <IconAlertTriangle size={22} aria-hidden />
                </Box>
                <Text size="md" style={{ flex: 1 }}>
                  {alert.message}
                </Text>
                <SeverityBadge severity={alert.severity} />
              </Group>
            ))}
          </Stack>
        </MobileSection>
      )}

      {canTickets && openTickets.length > 0 && (
        <MobileSection title={`Chamados abertos (${openTickets.length})`}>
          <Stack gap={8}>
            {openTickets.map((t) => (
              <Box
                key={t.id}
                component={Link}
                to={mobileTicketPath(t.id)}
                p="12px 16px"
                style={{ ...MOBILE_CARD, display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', color: 'inherit' }}
              >
                <Text size="sm" ff="monospace" c="var(--ce-text-secondary)">
                  #{t.id}
                </Text>
                <Text size="md" style={{ flex: 1 }}>
                  {t.title}
                </Text>
                <TicketStatusBadge status={t.status} />
              </Box>
            ))}
          </Stack>
        </MobileSection>
      )}

      <MobileSection title="Informações">
        <InfoRows
          rows={[
            { label: 'Cliente / site', value: `${agent.clientName} / ${agent.siteName}` },
            { label: 'Sistema', value: agent.operatingSystem || agent.plat },
            { label: 'Usuário logado', value: loggedUser(agent) ?? 'Nenhum' },
            { label: 'IP público', value: agent.publicIp ? <Text span ff="monospace" size="sm">{agent.publicIp}</Text> : 'Não informado' },
            { label: 'Último boot', value: formatDateTime(agent.bootTime, 'Não informado') },
            { label: 'Versão do agente', value: agent.version },
          ]}
        />
      </MobileSection>

      <MobileAgentActions agent={actions ? ref : null} onClose={() => setActions(false)} />
      <ShutdownModal agent={agent} opened={shutdownOpen} onClose={() => setShutdownOpen(false)} />
    </MobilePage>
  );
}
