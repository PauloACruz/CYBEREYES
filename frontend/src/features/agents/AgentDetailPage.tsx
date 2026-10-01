import { useState } from 'react';
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
  TextInput,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconActivity, IconDatabase, IconInfoCircle, IconListDetails, IconRefreshAlert, IconSearch, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
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
import { parseDisks, parseServices, type DiskInfo, type ServiceInfo } from './agentData';
import { loggedUser, MONITORING_TYPE_LABEL } from './agentFormat';
import { DeleteAgentModal } from './DeleteAgentModal';

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
  const [deleteOpened, deleteModal] = useDisclosure(false);

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
          {canManage && (
            <Button color="red" variant="light" leftSection={<IconTrash size={16} />} onClick={deleteModal.open}>
              Excluir
            </Button>
          )}
        </Group>
      </Group>

      <Tabs defaultValue="resumo" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="resumo" leftSection={<IconInfoCircle size={16} />}>
            Resumo
          </Tabs.Tab>
          <Tabs.Tab value="discos" leftSection={<IconDatabase size={16} />}>
            Discos
          </Tabs.Tab>
          <Tabs.Tab value="servicos" leftSection={<IconListDetails size={16} />}>
            Serviços
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="resumo">
          <SummaryTab agent={agent} />
        </Tabs.Panel>
        <Tabs.Panel value="discos">
          <DisksTab disks={parseDisks(agent.disks)} />
        </Tabs.Panel>
        <Tabs.Panel value="servicos">
          <ServicesTab services={parseServices(agent.services)} />
        </Tabs.Panel>
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

const SERVICE_STATUS: Record<string, { label: string; color: string }> = {
  running: { label: 'Em execução', color: 'teal' },
  stopped: { label: 'Parado', color: 'gray' },
  start_pending: { label: 'Iniciando', color: 'blue' },
  stop_pending: { label: 'Parando', color: 'orange' },
  paused: { label: 'Pausado', color: 'yellow' },
};

const START_TYPE: Record<string, string> = {
  automatic: 'Automático',
  auto: 'Automático',
  manual: 'Manual',
  disabled: 'Desativado',
};

function ServicesTab({ services }: { services: ServiceInfo[] | null }) {
  const [search, setSearch] = useState('');
  if (!services) {
    return (
      <Paper withBorder p="xl">
        <Text c="dimmed" ta="center">
          O agente não enviou a lista de serviços. Ela é coletada em máquinas Windows.
        </Text>
      </Paper>
    );
  }
  const term = search.trim().toLowerCase();
  const filtered = term
    ? services.filter((s) => s.name.toLowerCase().includes(term) || s.displayName.toLowerCase().includes(term))
    : services;
  const columns = 4;
  return (
    <>
      <TextInput
        placeholder="Buscar serviço por nome"
        aria-label="Buscar serviços"
        leftSection={<IconSearch size={16} />}
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
        mb="md"
        maw={360}
      />
      <Paper withBorder>
        <Table.ScrollContainer minWidth={700}>
          <Table striped verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Nome</Table.Th>
                <Table.Th>Estado</Table.Th>
                <Table.Th>Inicialização</Table.Th>
                <Table.Th>Conta</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filtered.length === 0 && (
                <EmptyRow columns={columns} message={term ? 'Nenhum serviço encontrado para a busca.' : 'Nenhum serviço informado.'} />
              )}
              {filtered.map((svc) => {
                const status = SERVICE_STATUS[svc.status.toLowerCase()];
                return (
                  <Table.Tr key={svc.name}>
                    <Table.Td>
                      <Text size="sm" fw={500}>
                        {svc.displayName || svc.name}
                      </Text>
                      {svc.displayName && svc.displayName !== svc.name && (
                        <Text size="xs" c="dimmed">
                          {svc.name}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Badge variant="light" size="sm" color={status?.color ?? 'gray'}>
                        {status?.label ?? (svc.status || 'Desconhecido')}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{START_TYPE[svc.startType.toLowerCase()] ?? svc.startType}</Table.Td>
                    <Table.Td>{svc.username}</Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
    </>
  );
}
