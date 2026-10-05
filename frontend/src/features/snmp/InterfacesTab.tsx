import { useState } from 'react';
import { Badge, Paper, Switch, Table, Text } from '@mantine/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import { snmpApi } from '../../api/snmp';
import type { SnmpDeviceDetail, SnmpInterfaceDto } from '../../api/types';
import { EmptyRow } from '../../components/TableStates';
import { formatBitsPerSecond, formatInteger } from '../../lib/format';
import { MetricChartPanel } from './MetricChartPanel';
import { adminStatusInfo, interfaceLabel, operStatusInfo } from './snmpFormat';

const COLUMNS = 9;

function errorsText(iface: SnmpInterfaceDto): string {
  if (iface.inErrors === null && iface.outErrors === null) return 'Sem dados';
  return `${formatInteger(iface.inErrors ?? 0)} / ${formatInteger(iface.outErrors ?? 0)}`;
}

export function InterfacesTab({ device, canManage }: { device: SnmpDeviceDetail; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<number | null>(null);
  const current = device.interfaces.find((i) => i.index === selected);

  const monitor = useMutation({
    mutationFn: ({ index, monitored }: { index: number; monitored: boolean }) => snmpApi.setInterfaceMonitored(device.id, index, monitored),
    onMutate: ({ index, monitored }) => {
      queryClient.setQueryData<SnmpDeviceDetail>(queryKeys.snmpDevice(device.id), (old) =>
        old ? { ...old, interfaces: old.interfaces.map((i) => (i.index === index ? { ...i, monitored } : i)) } : old,
      );
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: queryKeys.snmpDevice(device.id), exact: true }),
  });

  return (
    <>
      <Paper withBorder mb="md">
        <Table.ScrollContainer minWidth={1000}>
          <Table highlightOnHover verticalSpacing="xs" aria-label="Interfaces">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Nome</Table.Th>
                <Table.Th>Alias</Table.Th>
                <Table.Th>Velocidade</Table.Th>
                <Table.Th>Admin</Table.Th>
                <Table.Th>Oper</Table.Th>
                <Table.Th ta="right">Entrada</Table.Th>
                <Table.Th ta="right">Saída</Table.Th>
                <Table.Th ta="right">Erros (entrada / saída)</Table.Th>
                <Table.Th w={110}>Monitorar</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {device.interfaces.length === 0 && (
                <EmptyRow columns={COLUMNS} message="Nenhuma interface coletada. Verifique se a coleta de interfaces está ligada." />
              )}
              {device.interfaces.map((iface) => {
                const admin = adminStatusInfo(iface.adminStatus);
                const oper = operStatusInfo(iface.operStatus);
                const name = interfaceLabel(iface);
                const active = selected === iface.index;
                return (
                  <Table.Tr
                    key={iface.index}
                    tabIndex={0}
                    aria-selected={active}
                    bg={active ? 'var(--mantine-primary-color-light)' : undefined}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelected(active ? null : iface.index)}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
                      e.preventDefault();
                      setSelected(active ? null : iface.index);
                    }}
                  >
                    <Table.Td fw={500}>{name}</Table.Td>
                    <Table.Td>{iface.alias || <Text size="sm" c="dimmed">Sem alias</Text>}</Table.Td>
                    <Table.Td>{formatBitsPerSecond(iface.speedBps)}</Table.Td>
                    <Table.Td>
                      <Badge color={admin.color} variant="light" size="sm">
                        {admin.label}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Badge color={oper.color} variant="light" size="sm">
                        {oper.label}
                      </Badge>
                    </Table.Td>
                    <Table.Td ta="right" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatBitsPerSecond(iface.inBps)}
                    </Table.Td>
                    <Table.Td ta="right" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatBitsPerSecond(iface.outBps)}
                    </Table.Td>
                    <Table.Td ta="right" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {errorsText(iface)}
                    </Table.Td>
                    <Table.Td onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                      <Switch
                        aria-label={`Monitorar ${name}`}
                        checked={iface.monitored}
                        disabled={!canManage}
                        onChange={(e) => monitor.mutate({ index: iface.index, monitored: e.currentTarget.checked })}
                      />
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
      {current ? (
        <Paper withBorder p="md">
          <MetricChartPanel
            key={current.index}
            deviceId={device.id}
            title={`Tráfego de ${interfaceLabel(current)}`}
            formatValue={(v) => formatBitsPerSecond(v)}
            series={[
              { metric: `if:${current.index}:in`, label: 'Entrada', color: 'var(--ce-chart-1)' },
              { metric: `if:${current.index}:out`, label: 'Saída', color: 'var(--ce-chart-2)' },
            ]}
          />
        </Paper>
      ) : (
        device.interfaces.length > 0 && (
          <Text size="sm" c="dimmed">
            Clique numa interface para ver o gráfico de tráfego.
          </Text>
        )
      )}
    </>
  );
}
