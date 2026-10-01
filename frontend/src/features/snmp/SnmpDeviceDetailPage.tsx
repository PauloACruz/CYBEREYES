import { Alert, Anchor, Breadcrumbs, Button, Center, Grid, Group, Loader, Paper, SimpleGrid, Stack, Tabs, Text, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconAlertTriangle, IconCpu, IconFileText, IconNetwork, IconPencil, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ApiError } from '../../api/client';
import { queryKeys } from '../../api/queryKeys';
import { snmpApi } from '../../api/snmp';
import { PERMISSIONS, type SnmpDeviceDetail } from '../../api/types';
import { agentPath, assetPath, PATHS } from '../../app/paths';
import { hasPermission } from '../../auth/permissions';
import { useMe } from '../../auth/useMe';
import { NotFound } from '../../components/NotFound';
import { LoadError } from '../../components/TableStates';
import { confirmAction, notifySuccess } from '../../lib/feedback';
import { formatDateTime, formatDuration } from '../../lib/format';
import { Field } from '../inventory/sheetDisplay';
import { LogsView } from '../logs/LogsView';
import { InterfacesTab } from './InterfacesTab';
import { MetricChartPanel } from './MetricChartPanel';
import { SensorsTab } from './SensorsTab';
import { SnmpDeviceFormModal } from './SnmpDeviceFormModal';
import { SnmpStatusBadge } from './SnmpStatusBadge';
import { TRAP_SEVERITY_OPTIONS } from './snmpFormat';

const rttFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

export function SnmpDeviceDetailPage() {
  const { id: rawId } = useParams();
  const id = Number(rawId);
  const valid = Number.isInteger(id) && id > 0;
  const device = useQuery({ queryKey: queryKeys.snmpDevice(id), queryFn: () => snmpApi.device(id), enabled: valid });

  if (!valid || (device.error instanceof ApiError && device.error.status === 404)) return <NotFound />;
  if (device.isError) return <LoadError error={device.error} onRetry={() => void device.refetch()} />;
  if (!device.data) {
    return (
      <Center py="xl">
        <Loader aria-label="Carregando dispositivo" />
      </Center>
    );
  }
  return <SnmpDeviceView device={device.data} />;
}

function orMissing(value: string | null | undefined): ReactNode {
  return value ? (
    value
  ) : (
    <Text size="sm" c="dimmed" span>
      Não informado
    </Text>
  );
}

function SnmpDeviceView({ device }: { device: SnmpDeviceDetail }) {
  const { data: me } = useMe();
  const canManage = hasPermission(me, PERMISSIONS.snmpManage);
  const canViewLogs = hasPermission(me, PERMISSIONS.logsView);
  const canViewInventory = hasPermission(me, PERMISSIONS.inventoryView);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [editOpened, editModal] = useDisclosure(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const remove = useMutation({
    mutationFn: () => snmpApi.remove(device.id),
    onSuccess: async () => {
      notifySuccess(`Dispositivo ${device.name} excluído.`);
      queryClient.removeQueries({ queryKey: queryKeys.snmpDevice(device.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.snmpDeviceLists });
      await navigate(PATHS.snmp);
    },
  });

  const tabs = ['interfaces', 'sensores', ...(canViewLogs ? ['logs'] : [])];
  const requested = searchParams.get('aba');
  const activeTab = requested && tabs.includes(requested) ? requested : 'interfaces';
  const selectTab = (value: string | null) => {
    if (!value) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === 'interfaces') next.delete('aba');
        else next.set('aba', value);
        return next;
      },
      { replace: true },
    );
  };
  const trapLabel = TRAP_SEVERITY_OPTIONS.find((o) => o.value === device.trapSeverity)?.label ?? device.trapSeverity;

  return (
    <>
      <Breadcrumbs mb="xs">
        <Anchor component={Link} to={PATHS.snmp} size="sm">
          Rede SNMP
        </Anchor>
        <Text size="sm">{device.name}</Text>
      </Breadcrumbs>
      <Group justify="space-between" align="flex-start" mb="lg" wrap="wrap" gap="sm">
        <Stack gap={6}>
          <Group gap="sm">
            <Title order={2}>{device.name}</Title>
            <SnmpStatusBadge status={device.status} size="md" />
          </Group>
          <Text c="dimmed" size="sm">
            {device.host}:{device.port} · SNMP {device.version} · {device.clientName}
            {device.enabled ? '' : ' · coleta desativada'}
          </Text>
        </Stack>
        {canManage && (
          <Group gap="sm">
            <Button leftSection={<IconPencil size={16} />} onClick={editModal.open}>
              Editar
            </Button>
            <Button
              color="red"
              variant="light"
              leftSection={<IconTrash size={16} />}
              loading={remove.isPending}
              onClick={() =>
                confirmAction({
                  title: 'Excluir dispositivo',
                  message: `Excluir o dispositivo ${device.name}, as interfaces, os sensores e o histórico de coletas?`,
                  confirmLabel: 'Excluir',
                  danger: true,
                  onConfirm: () => remove.mutate(),
                })
              }
            >
              Excluir
            </Button>
          </Group>
        )}
      </Group>

      {device.lastError && (
        <Alert color="red" variant="light" icon={<IconAlertTriangle size={18} />} title="Último erro de coleta" mb="md">
          {device.lastError}
        </Alert>
      )}

      <Grid gap="md" mb="lg">
        <Grid.Col span={{ base: 12, lg: 6 }}>
          <Paper withBorder p="lg" h="100%">
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
              <Field label="sysName">{orMissing(device.sysName)}</Field>
              <Field label="Uptime">{formatDuration(device.uptimeSeconds)}</Field>
              <Field label="Localização">{orMissing(device.sysLocation)}</Field>
              <Field label="Contato">{orMissing(device.sysContact)}</Field>
              <Field label="Coletor">
                <Anchor component={Link} to={agentPath(device.collectorAgentId)} size="sm">
                  {device.collectorHostname ?? `Agente ${device.collectorAgentId}`}
                </Anchor>
              </Field>
              <Field label="Ativo vinculado">
                {device.assetId === null ? (
                  orMissing(null)
                ) : canViewInventory ? (
                  <Anchor component={Link} to={assetPath(device.assetId)} size="sm">
                    Abrir ficha do ativo
                  </Anchor>
                ) : (
                  `Ativo ${device.assetId}`
                )}
              </Field>
              <Field label="Última coleta">{formatDateTime(device.lastPolledAt)}</Field>
              <Field label="Intervalo">{formatDuration(device.interval)}</Field>
              <Field label="Traps">{trapLabel}</Field>
              <Field label="Interfaces fora">
                {device.interfacesDown} de {device.interfaceCount}
              </Field>
            </SimpleGrid>
            <Field label="sysDescr">
              <Text size="sm" mt={4} style={{ whiteSpace: 'pre-wrap' }}>
                {device.sysDescr || 'Não informado'}
              </Text>
            </Field>
          </Paper>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 6 }}>
          <Paper withBorder p="lg" h="100%">
            <MetricChartPanel
              deviceId={device.id}
              title="Tempo de resposta"
              formatValue={(v) => `${rttFormat.format(v)} ms`}
              series={[{ metric: 'rtt', label: 'Tempo de resposta', color: 'var(--wc-chart-1)' }]}
            />
          </Paper>
        </Grid.Col>
      </Grid>

      <Tabs value={activeTab} onChange={selectTab} keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="interfaces" leftSection={<IconNetwork size={16} />}>
            Interfaces
          </Tabs.Tab>
          <Tabs.Tab value="sensores" leftSection={<IconCpu size={16} />}>
            Sensores
          </Tabs.Tab>
          {canViewLogs && (
            <Tabs.Tab value="logs" leftSection={<IconFileText size={16} />}>
              Logs
            </Tabs.Tab>
          )}
        </Tabs.List>
        <Tabs.Panel value="interfaces">
          <InterfacesTab device={device} canManage={canManage} />
        </Tabs.Panel>
        <Tabs.Panel value="sensores">
          <SensorsTab device={device} canManage={canManage} />
        </Tabs.Panel>
        {canViewLogs && (
          <Tabs.Panel value="logs">
            <LogsView deviceId={device.id} showSummary={false} />
          </Tabs.Panel>
        )}
      </Tabs>

      {canManage && <SnmpDeviceFormModal opened={editOpened} onClose={editModal.close} device={device} />}
    </>
  );
}
