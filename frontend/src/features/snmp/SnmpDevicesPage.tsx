import { Anchor, Button, Group, Paper, Select, Table, Text, Tooltip } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconPlus } from '@tabler/icons-react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { queryKeys } from '../../api/queryKeys';
import { snmpApi } from '../../api/snmp';
import { PERMISSIONS, type ListSnmpDevicesParams } from '../../api/types';
import { agentPath, snmpDevicePath } from '../../app/paths';
import { hasPermission } from '../../auth/permissions';
import { useMe } from '../../auth/useMe';
import { PageHeader } from '../../components/PageHeader';
import { EmptyRow, LoadError, LoadingRows } from '../../components/TableStates';
import { formatDuration } from '../../lib/format';
import { RelativeTime } from '../agents/agentDisplay';
import { useClients } from '../clients/useClients';
import { isSnmpStatus, SNMP_STATUS_OPTIONS } from './snmpFormat';
import { SnmpDeviceFormModal } from './SnmpDeviceFormModal';
import { SnmpStatusBadge } from './SnmpStatusBadge';

const COLUMNS = 10;

function toId(value: string | null): number | undefined {
  if (!value) return undefined;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

export function SnmpDevicesPage() {
  const { data: me } = useMe();
  const canManage = hasPermission(me, PERMISSIONS.snmpManage);
  const clients = useClients(hasPermission(me, PERMISSIONS.clientsView));
  const [searchParams, setSearchParams] = useSearchParams();
  const [formOpened, formModal] = useDisclosure(false);

  const statusParam = searchParams.get('status');
  const params: ListSnmpDevicesParams = {
    clientId: toId(searchParams.get('cliente')),
    status: isSnmpStatus(statusParam) ? statusParam : undefined,
  };
  const updateParam = (key: string, value: string | null) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  const devices = useQuery({
    queryKey: queryKeys.snmpDevices(params),
    queryFn: () => snmpApi.devices(params),
    placeholderData: keepPreviousData,
  });
  const rows = devices.data ?? [];
  const filtered = params.clientId !== undefined || params.status !== undefined;

  return (
    <>
      <PageHeader
        title="Rede SNMP"
        description="Switches, impressoras, roteadores e outros equipamentos coletados por SNMP pelos agentes coletores."
        actions={
          canManage && (
            <Button leftSection={<IconPlus size={16} />} onClick={formModal.open}>
              Novo dispositivo
            </Button>
          )
        }
      />
      <Group mb="md" gap="sm">
        {clients.data && (
          <Select
            aria-label="Cliente"
            placeholder="Todos os clientes"
            clearable
            searchable
            data={clients.data.map((c) => ({ value: String(c.id), label: c.name }))}
            value={params.clientId ? String(params.clientId) : null}
            onChange={(v) => updateParam('cliente', v)}
            w={240}
          />
        )}
        <Select
          aria-label="Status"
          placeholder="Todos os status"
          clearable
          data={SNMP_STATUS_OPTIONS}
          value={params.status ?? null}
          onChange={(v) => updateParam('status', v)}
          w={200}
        />
      </Group>
      {devices.isError && <LoadError error={devices.error} onRetry={() => void devices.refetch()} />}
      <Paper withBorder style={{ opacity: devices.isPlaceholderData ? 0.6 : 1 }}>
        <Table.ScrollContainer minWidth={1180}>
          <Table striped highlightOnHover verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={130}>Status</Table.Th>
                <Table.Th>Nome</Table.Th>
                <Table.Th>Host</Table.Th>
                <Table.Th>Cliente</Table.Th>
                <Table.Th>Coletor</Table.Th>
                <Table.Th>sysName</Table.Th>
                <Table.Th>Uptime</Table.Th>
                <Table.Th>Interfaces fora/total</Table.Th>
                <Table.Th>Última coleta</Table.Th>
                <Table.Th>Erro</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {devices.isPending && <LoadingRows columns={COLUMNS} />}
              {devices.isSuccess && rows.length === 0 && (
                <EmptyRow columns={COLUMNS} message={filtered ? 'Nenhum dispositivo encontrado com estes filtros.' : 'Nenhum dispositivo SNMP cadastrado.'} />
              )}
              {rows.map((d) => (
                <Table.Tr key={d.id}>
                  <Table.Td>
                    <SnmpStatusBadge status={d.status} />
                  </Table.Td>
                  <Table.Td>
                    <Anchor component={Link} to={snmpDevicePath(d.id)} size="sm" fw={500}>
                      {d.name}
                    </Anchor>
                    {!d.enabled && (
                      <Text size="xs" c="dimmed">
                        Coleta desativada
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" ff="monospace">
                      {d.host}
                    </Text>
                  </Table.Td>
                  <Table.Td>{d.clientName}</Table.Td>
                  <Table.Td>
                    <Anchor component={Link} to={agentPath(d.collectorAgentId)} size="sm">
                      {d.collectorHostname ?? `Agente ${d.collectorAgentId}`}
                    </Anchor>
                  </Table.Td>
                  <Table.Td>{d.sysName ?? <Text size="sm" c="dimmed">Não informado</Text>}</Table.Td>
                  <Table.Td>{formatDuration(d.uptimeSeconds)}</Table.Td>
                  <Table.Td>
                    <Text size="sm" c={d.interfacesDown > 0 ? 'red' : undefined} fw={d.interfacesDown > 0 ? 600 : undefined}>
                      {d.interfacesDown}/{d.interfaceCount}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <RelativeTime value={d.lastPolledAt} />
                  </Table.Td>
                  <Table.Td maw={240}>
                    {d.lastError ? (
                      <Tooltip label={d.lastError} multiline maw={360} withArrow>
                        <Text size="sm" c="red" truncate="end">
                          {d.lastError}
                        </Text>
                      </Tooltip>
                    ) : (
                      <Text size="sm" c="dimmed">
                        Nenhum
                      </Text>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
      {canManage && <SnmpDeviceFormModal opened={formOpened} onClose={formModal.close} device={null} />}
    </>
  );
}
