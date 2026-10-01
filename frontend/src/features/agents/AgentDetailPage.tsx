import { lazy, Suspense, useState } from 'react';
import {
  Anchor,
  Badge,
  Breadcrumbs,
  Button,
  Center,
  Group,
  Loader,
  Paper,
  Progress,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconActivity,
  IconBinaryTree,
  IconCode,
  IconDatabase,
  IconFileText,
  IconHistory,
  IconInfoCircle,
  IconListDetails,
  IconPrompt,
  IconRefreshAlert,
  IconServer,
  IconTerminal2,
  IconTrash,
  type Icon,
} from '@tabler/icons-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { agentsApi } from '../../api/agents';
import { ApiError } from '../../api/client';
import { queryKeys } from '../../api/queryKeys';
import { PERMISSIONS, type AgentDetail } from '../../api/types';
import { PATHS } from '../../app/paths';
import { hasPermission } from '../../auth/permissions';
import { useMe } from '../../auth/useMe';
import { NotFound } from '../../components/NotFound';
import { EmptyRow, LoadError } from '../../components/TableStates';
import { formatDateTime } from '../../lib/format';
import { AgentStatusBadge, OperatingSystem, RelativeTime } from './agentDisplay';
import { parseDisks, type DiskInfo } from './agentData';
import { loggedUser, MONITORING_TYPE_LABEL } from './agentFormat';
import { DeleteAgentModal } from './DeleteAgentModal';
import { AgentActionsMenu } from './actions/AgentActionsMenu';
import { CommandTab } from './actions/CommandTab';
import { EventLogTab } from './actions/EventLogTab';
import { HistoryTab } from './actions/HistoryTab';
import { LiveServicesTab } from './actions/LiveServicesTab';
import { ProcessesTab } from './actions/ProcessesTab';
import { ScriptRunTab } from './actions/ScriptRunTab';
import { isWindows } from './actions/shells';

// Abas pesadas (xterm.js e navegador do registro) carregam sob demanda.
const TerminalTab = lazy(() => import('./actions/TerminalTab').then((m) => ({ default: m.TerminalTab })));
const RegistryTab = lazy(() => import('./actions/RegistryTab').then((m) => ({ default: m.RegistryTab })));

interface TabDef {
  value: string;
  label: string;
  icon: Icon;
  render: () => ReactNode;
  /** Mantem o conteudo montado depois da primeira visita (sessao do terminal). */
  keepMounted?: boolean;
}

function TabFallback() {
  return (
    <Center py="xl">
      <Loader aria-label="Carregando aba" />
    </Center>
  );
}

export function AgentDetailPage() {
  const { id: rawId } = useParams();
  const id = Number(rawId);
  const valid = Number.isInteger(id) && id > 0;
  const agent = useQuery({ queryKey: queryKeys.agentDetail(id), queryFn: () => agentsApi.get(id), enabled: valid });

  if (!valid || (agent.error instanceof ApiError && agent.error.status === 404)) return <NotFound />;
  if (agent.isError) return <LoadError error={agent.error} onRetry={() => void agent.refetch()} />;
  if (!agent.data) {
    return (
      <Center py="xl">
        <Loader aria-label="Carregando agente" />
      </Center>
    );
  }
  return <AgentDetailView agent={agent.data} />;
}

function AgentDetailView({ agent }: { agent: AgentDetail }) {
  const { data: me } = useMe();
  const canManage = hasPermission(me, PERMISSIONS.agentsManage);
  const canRun = hasPermission(me, PERMISSIONS.agentsRun);
  const canControl = hasPermission(me, PERMISSIONS.agentsControl);
  const canViewScripts = hasPermission(me, PERMISSIONS.scriptsView);
  const windows = isWindows(agent.plat);
  const [deleteOpened, deleteModal] = useDisclosure(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [terminalVisited, setTerminalVisited] = useState(() => searchParams.get('aba') === 'terminal');

  const tabs: TabDef[] = [
    { value: 'resumo', label: 'Resumo', icon: IconInfoCircle, render: () => <SummaryTab agent={agent} /> },
    { value: 'discos', label: 'Discos', icon: IconDatabase, render: () => <DisksTab disks={parseDisks(agent.disks)} /> },
  ];
  if (canRun) tabs.push({ value: 'comando', label: 'Comando', icon: IconPrompt, render: () => <CommandTab agent={agent} /> });
  if (canRun && canViewScripts) tabs.push({ value: 'scripts', label: 'Scripts', icon: IconCode, render: () => <ScriptRunTab agent={agent} /> });
  if (canRun) {
    tabs.push({
      value: 'terminal',
      label: 'Terminal',
      icon: IconTerminal2,
      keepMounted: terminalVisited,
      render: () => (
        <Suspense fallback={<TabFallback />}>
          <TerminalTab agent={agent} />
        </Suspense>
      ),
    });
  }
  tabs.push({ value: 'processos', label: 'Processos', icon: IconListDetails, render: () => <ProcessesTab agent={agent} canControl={canControl} /> });
  if (windows) {
    tabs.push(
      { value: 'servicos', label: 'Serviços', icon: IconServer, render: () => <LiveServicesTab agent={agent} canControl={canControl} /> },
      { value: 'eventlog', label: 'Event Log', icon: IconFileText, render: () => <EventLogTab agent={agent} /> },
      {
        value: 'registro',
        label: 'Registro',
        icon: IconBinaryTree,
        render: () => (
          <Suspense fallback={<TabFallback />}>
            <RegistryTab agent={agent} canControl={canControl} />
          </Suspense>
        ),
      },
    );
  }
  tabs.push({ value: 'historico', label: 'Histórico', icon: IconHistory, render: () => <HistoryTab agent={agent} /> });

  const requested = searchParams.get('aba');
  const activeTab = tabs.some((t) => t.value === requested) ? (requested ?? 'resumo') : 'resumo';
  const selectTab = (value: string | null) => {
    if (!value) return;
    if (value === 'terminal') setTerminalVisited(true);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === 'resumo') next.delete('aba');
        else next.set('aba', value);
        return next;
      },
      { replace: true },
    );
  };

  const ping = useMutation({
    mutationFn: () => agentsApi.ping(agent.id),
    onSuccess: (res) => {
      if (res.status === 'online') {
        notifications.show({ color: 'teal', title: 'Ping', message: `${agent.hostname} respondeu ao ping.` });
      } else {
        notifications.show({ color: 'orange', title: 'Ping', message: `${agent.hostname} não respondeu ao ping.` });
      }
    },
  });

  return (
    <>
      <Breadcrumbs mb="xs">
        <Anchor component={Link} to={PATHS.agents} size="sm">
          Agentes
        </Anchor>
        <Text size="sm">{agent.hostname}</Text>
      </Breadcrumbs>
      <Group justify="space-between" align="flex-start" mb="lg" wrap="wrap" gap="sm">
        <Stack gap={6}>
          <Group gap="sm">
            <Title order={2}>{agent.hostname}</Title>
            <AgentStatusBadge status={agent.status} size="md" />
            {agent.needsReboot && (
              <Badge color="yellow" variant="light" leftSection={<IconRefreshAlert size={12} aria-hidden />}>
                Reinício pendente
              </Badge>
            )}
          </Group>
          <Text c="dimmed" size="sm">
            {agent.clientName} / {agent.siteName} · {MONITORING_TYPE_LABEL[agent.monitoringType]} · visto por último{' '}
            <RelativeTime value={agent.lastSeen} />
          </Text>
        </Stack>
        <Group gap="sm">
          <Button variant="light" leftSection={<IconActivity size={16} />} loading={ping.isPending} onClick={() => ping.mutate()}>
            Ping
          </Button>
          <AgentActionsMenu agent={agent} canControl={canControl} />
          {canManage && (
            <Button color="red" variant="light" leftSection={<IconTrash size={16} />} onClick={deleteModal.open}>
              Excluir
            </Button>
          )}
        </Group>
      </Group>

      <Tabs value={activeTab} onChange={selectTab} keepMounted={false} keepMountedMode="display-none">
        <Tabs.List mb="md">
          {tabs.map((tab) => (
            <Tabs.Tab key={tab.value} value={tab.value} leftSection={<tab.icon size={16} />}>
              {tab.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        {tabs.map((tab) => (
          <Tabs.Panel key={tab.value} value={tab.value} keepMounted={tab.keepMounted}>
            {tab.render()}
          </Tabs.Panel>
        ))}
      </Tabs>

      {canManage && <DeleteAgentModal agent={agent} opened={deleteOpened} onClose={deleteModal.close} />}
    </>
  );
}

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

function orDash(value: string | null | undefined): string {
  return value || 'Não informado';
}

function SummaryTab({ agent }: { agent: AgentDetail }) {
  const arch = agent.goArch ?? agent.goarch;
  return (
    <Paper withBorder p="lg">
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
        <Field label="Sistema operacional">
          <OperatingSystem plat={agent.plat} operatingSystem={agent.operatingSystem} />
        </Field>
        <Field label="Arquitetura">{orDash(arch)}</Field>
        <Field label="Memória RAM">{agent.totalRam ? `${agent.totalRam} GB` : 'Não informado'}</Field>
        <Field label="IP público">{orDash(agent.publicIp)}</Field>
        <Field label="Último boot">{formatDateTime(agent.bootTime, 'Não informado')}</Field>
        <Field label="Usuário logado">{orDash(loggedUser(agent))}</Field>
        <Field label="Versão do agente">{orDash(agent.version)}</Field>
        <Field label="Criado em">{formatDateTime(agent.createdAt)}</Field>
        <Field label="Visto por último">{formatDateTime(agent.lastSeen)}</Field>
        <Field label="Descrição">{orDash(agent.description)}</Field>
        <Field label="Intervalos">
          Check-in a cada {agent.checkInterval} s; offline após {agent.offlineTime} min; em atraso após {agent.overdueTime} min
        </Field>
      </SimpleGrid>
    </Paper>
  );
}

function usageColor(percent: number): string {
  if (percent >= 90) return 'red';
  if (percent >= 75) return 'orange';
  return 'teal';
}

function DisksTab({ disks }: { disks: DiskInfo[] | null }) {
  const columns = 6;
  return (
    <Paper withBorder>
      <Table.ScrollContainer minWidth={700}>
        <Table verticalSpacing="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Dispositivo</Table.Th>
              <Table.Th>Sistema de arquivos</Table.Th>
              <Table.Th>Total</Table.Th>
              <Table.Th>Usado</Table.Th>
              <Table.Th>Livre</Table.Th>
              <Table.Th w={220}>Uso</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(!disks || disks.length === 0) && <EmptyRow columns={columns} message="O agente ainda não enviou dados de discos." />}
            {disks?.map((disk) => (
              <Table.Tr key={disk.device}>
                <Table.Td fw={500}>{disk.device}</Table.Td>
                <Table.Td>{disk.fstype}</Table.Td>
                <Table.Td>{disk.total}</Table.Td>
                <Table.Td>{disk.used}</Table.Td>
                <Table.Td>{disk.free}</Table.Td>
                <Table.Td>
                  <Group gap="xs" wrap="nowrap">
                    <Progress
                      value={disk.percent}
                      color={usageColor(disk.percent)}
                      w={140}
                      aria-label={`Uso de ${disk.device}`}
                    />
                    <Text size="sm">{Math.round(disk.percent)}%</Text>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Paper>
  );
}
