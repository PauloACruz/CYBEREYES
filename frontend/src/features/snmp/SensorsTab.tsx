import { useState } from 'react';
import { ActionIcon, Badge, Button, Group, Modal, NumberInput, Paper, Select, SimpleGrid, Stack, Table, Text, TextInput, Tooltip } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import { snmpApi } from '../../api/snmp';
import type { SaveSnmpSensorRequest, SnmpDeviceDetail, SnmpSensorDto } from '../../api/types';
import type { ChartThreshold } from '../../components/charts/TimeSeriesChart';
import { EmptyRow } from '../../components/TableStates';
import { confirmAction, notifySuccess } from '../../lib/feedback';
import { applyServerErrors } from '../../lib/forms';
import { RelativeTime } from '../agents/agentDisplay';
import { MetricChartPanel } from './MetricChartPanel';
import { formatSensorValue, SENSOR_STATE_INFO, SENSOR_TEMPLATES, sensorState } from './snmpFormat';

const valueFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

function limitsText(sensor: SnmpSensorDto): string {
  const parts: string[] = [];
  const fmt = (v: number) => (sensor.unit ? `${valueFormat.format(v)} ${sensor.unit}` : valueFormat.format(v));
  if (sensor.warnAbove !== null) parts.push(`aviso acima de ${fmt(sensor.warnAbove)}`);
  if (sensor.critAbove !== null) parts.push(`crítico acima de ${fmt(sensor.critAbove)}`);
  if (sensor.warnBelow !== null) parts.push(`aviso abaixo de ${fmt(sensor.warnBelow)}`);
  if (sensor.critBelow !== null) parts.push(`crítico abaixo de ${fmt(sensor.critBelow)}`);
  return parts.length > 0 ? parts.join('; ') : 'Sem limites';
}

function sensorThresholds(sensor: SnmpSensorDto): ChartThreshold[] {
  const items: ChartThreshold[] = [];
  const warn = 'var(--mantine-color-orange-6)';
  const crit = 'var(--mantine-color-red-6)';
  if (sensor.warnAbove !== null) items.push({ value: sensor.warnAbove, label: 'Aviso acima', color: warn });
  if (sensor.critAbove !== null) items.push({ value: sensor.critAbove, label: 'Crítico acima', color: crit });
  if (sensor.warnBelow !== null) items.push({ value: sensor.warnBelow, label: 'Aviso abaixo', color: warn });
  if (sensor.critBelow !== null) items.push({ value: sensor.critBelow, label: 'Crítico abaixo', color: crit });
  return items;
}

export function SensorsTab({ device, canManage }: { device: SnmpDeviceDetail; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ sensor: SnmpSensorDto | null } | null>(null);
  const current = device.sensors.find((s) => s.id === selected);
  const columns = canManage ? 6 : 5;

  const remove = useMutation({
    mutationFn: (sensor: SnmpSensorDto) => snmpApi.removeSensor(device.id, sensor.id),
    onSuccess: (_, sensor) => {
      notifySuccess(`Sensor ${sensor.name} excluído.`);
      if (selected === sensor.id) setSelected(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.snmpDevice(device.id), exact: true });
    },
  });

  return (
    <>
      {canManage && (
        <Group justify="flex-end" mb="sm">
          <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing({ sensor: null })}>
            Novo sensor
          </Button>
        </Group>
      )}
      <Paper withBorder mb="md">
        <Table.ScrollContainer minWidth={820}>
          <Table highlightOnHover verticalSpacing="xs" aria-label="Sensores">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Nome</Table.Th>
                <Table.Th>OID</Table.Th>
                <Table.Th>Último valor</Table.Th>
                <Table.Th>Limites</Table.Th>
                <Table.Th>Atualizado</Table.Th>
                {canManage && <Table.Th w={90} aria-label="Ações" />}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {device.sensors.length === 0 && <EmptyRow columns={columns} message="Nenhum sensor cadastrado." />}
              {device.sensors.map((sensor) => {
                const state = SENSOR_STATE_INFO[sensorState(sensor)];
                const active = selected === sensor.id;
                return (
                  <Table.Tr
                    key={sensor.id}
                    tabIndex={0}
                    aria-selected={active}
                    bg={active ? 'var(--mantine-primary-color-light)' : undefined}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelected(active ? null : sensor.id)}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
                      e.preventDefault();
                      setSelected(active ? null : sensor.id);
                    }}
                  >
                    <Table.Td fw={500}>{sensor.name}</Table.Td>
                    <Table.Td>
                      <Text size="sm" ff="monospace">
                        {sensor.oid}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Group gap="xs" wrap="nowrap">
                        <Badge color={state.color} variant="light" size="sm">
                          {state.label}
                        </Badge>
                        <Text size="sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {sensor.lastValue === null && sensor.lastText ? sensor.lastText : formatSensorValue(sensor.lastValue, sensor.unit)}
                        </Text>
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{limitsText(sensor)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <RelativeTime value={sensor.lastAt} />
                    </Table.Td>
                    {canManage && (
                      <Table.Td onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                        <Group gap={4} wrap="nowrap" justify="flex-end">
                          <Tooltip label="Editar">
                            <ActionIcon variant="subtle" color="gray" aria-label={`Editar sensor ${sensor.name}`} onClick={() => setEditing({ sensor })}>
                              <IconPencil size={16} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label="Excluir">
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              aria-label={`Excluir sensor ${sensor.name}`}
                              onClick={() =>
                                confirmAction({
                                  title: 'Excluir sensor',
                                  message: `Excluir o sensor ${sensor.name} e o histórico de leituras?`,
                                  confirmLabel: 'Excluir',
                                  danger: true,
                                  onConfirm: () => remove.mutate(sensor),
                                })
                              }
                            >
                              <IconTrash size={16} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      </Table.Td>
                    )}
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
            key={current.id}
            deviceId={device.id}
            title={`Leituras de ${current.name}`}
            formatValue={(v) => formatSensorValue(v, current.unit)}
            series={[{ metric: `sensor:${current.id}`, label: current.name, color: 'var(--ce-chart-1)' }]}
            thresholds={sensorThresholds(current)}
          />
        </Paper>
      ) : (
        device.sensors.length > 0 && (
          <Text size="sm" c="dimmed">
            Clique num sensor para ver o gráfico das leituras.
          </Text>
        )
      )}
      <Modal opened={editing !== null} onClose={() => setEditing(null)} title={editing?.sensor ? 'Editar sensor' : 'Novo sensor'} size="lg" centered>
        {editing && <SensorForm key={editing.sensor?.id ?? 'novo'} deviceId={device.id} sensor={editing.sensor} onClose={() => setEditing(null)} />}
      </Modal>
    </>
  );
}

interface SensorFormValues {
  name: string;
  oid: string;
  unit: string;
  warnAbove: number | string;
  critAbove: number | string;
  warnBelow: number | string;
  critBelow: number | string;
}

function toFormValues(values: SaveSnmpSensorRequest): SensorFormValues {
  return {
    name: values.name,
    oid: values.oid,
    unit: values.unit ?? '',
    warnAbove: values.warnAbove ?? '',
    critAbove: values.critAbove ?? '',
    warnBelow: values.warnBelow ?? '',
    critBelow: values.critBelow ?? '',
  };
}

function optionalNumber(value: number | string): number | null {
  if (value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

const EMPTY_SENSOR: SaveSnmpSensorRequest = { name: '', oid: '', unit: null, warnAbove: null, critAbove: null, warnBelow: null, critBelow: null };

function SensorForm({ deviceId, sensor, onClose }: { deviceId: number; sensor: SnmpSensorDto | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const form = useForm<SensorFormValues>({
    initialValues: toFormValues(sensor ?? EMPTY_SENSOR),
    validate: {
      name: (v) => (v.trim() ? null : 'Informe o nome'),
      oid: (v) => (/^\.?\d+(\.\d+)+$/.test(v.trim()) ? null : 'Informe um OID numérico, por exemplo 1.3.6.1.2.1.1.3.0'),
    },
  });
  const save = useMutation({
    mutationFn: (body: SaveSnmpSensorRequest) => (sensor ? snmpApi.updateSensor(deviceId, sensor.id, body) : snmpApi.createSensor(deviceId, body)),
    onSuccess: async () => {
      notifySuccess(sensor ? 'Sensor atualizado.' : 'Sensor criado.');
      await queryClient.invalidateQueries({ queryKey: queryKeys.snmpDevice(deviceId), exact: true });
      onClose();
    },
    onError: (error) => applyServerErrors(form, error),
  });

  return (
    <form
      onSubmit={form.onSubmit((v) =>
        save.mutate({
          name: v.name.trim(),
          oid: v.oid.trim().replace(/^\./, ''),
          unit: v.unit.trim() || null,
          warnAbove: optionalNumber(v.warnAbove),
          critAbove: optionalNumber(v.critAbove),
          warnBelow: optionalNumber(v.warnBelow),
          critBelow: optionalNumber(v.critBelow),
        }),
      )}
      noValidate
    >
      <Stack>
        {!sensor && (
          <Select
            label="Modelo"
            description="Atalho para preencher os campos; ajuste o OID conforme o equipamento."
            placeholder="Personalizado"
            clearable
            data={SENSOR_TEMPLATES.map((t) => ({ value: t.key, label: t.label }))}
            onChange={(key) => {
              const template = SENSOR_TEMPLATES.find((t) => t.key === key);
              form.setValues(toFormValues(template ? template.values : EMPTY_SENSOR));
            }}
          />
        )}
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label="Nome" required data-autofocus {...form.getInputProps('name')} />
          <TextInput label="Unidade" placeholder="Ex.: °C, %, páginas" {...form.getInputProps('unit')} />
        </SimpleGrid>
        <TextInput label="OID" required ff="monospace" placeholder="1.3.6.1.4.1..." {...form.getInputProps('oid')} />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <NumberInput label="Aviso acima de" {...form.getInputProps('warnAbove')} />
          <NumberInput label="Crítico acima de" {...form.getInputProps('critAbove')} />
          <NumberInput label="Aviso abaixo de" {...form.getInputProps('warnBelow')} />
          <NumberInput label="Crítico abaixo de" {...form.getInputProps('critBelow')} />
        </SimpleGrid>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            {sensor ? 'Salvar' : 'Criar'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
