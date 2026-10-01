import { useState } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Modal,
  MultiSelect,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import { ticketQueuesApi, ticketsApi } from '../../api/tickets';
import type { IncidentSettingsDto, SaveTicketQueueRequest, SlaRuleDto, TicketPriority, TicketQueueDto } from '../../api/types';
import { EmptyRow, LoadError, LoadingRows } from '../../components/TableStates';
import { confirmAction, notifySuccess } from '../../lib/feedback';
import { applyServerErrors } from '../../lib/forms';
import { isSeverity, SEVERITY_OPTIONS } from '../monitoring/monitoringFormat';
import { formatMinutes, isTicketPriority, PRIORITY_OPTIONS, TICKET_PRIORITIES, TICKET_PRIORITY_INFO } from '../tickets/ticketFormat';

export function TicketsSection() {
  return (
    <section aria-labelledby="chamados-title">
      <Title order={3} id="chamados-title">
        Chamados
      </Title>
      <Text size="sm" c="dimmed" mb="md">
        Filas de atendimento, prazos de SLA por prioridade e abertura automática de incidentes a partir de alertas.
      </Text>
      <Stack gap="lg">
        <QueuesPanel />
        <SlaPanel />
        <IncidentPanel />
      </Stack>
    </section>
  );
}

const QUEUE_COLUMNS = 4;

function QueuesPanel() {
  const queryClient = useQueryClient();
  const queues = useQuery({ queryKey: queryKeys.ticketQueues, queryFn: ticketQueuesApi.list });
  const [editing, setEditing] = useState<{ queue: TicketQueueDto | null } | null>(null);

  const remove = useMutation({
    mutationFn: (queue: TicketQueueDto) => ticketQueuesApi.remove(queue.id),
    onSuccess: (_, queue) => {
      notifySuccess(`Fila ${queue.name} excluída.`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.ticketQueues });
    },
  });

  return (
    <div>
      <Group justify="space-between" mb="xs" align="flex-end">
        <Title order={4}>Filas</Title>
        <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setEditing({ queue: null })}>
          Nova fila
        </Button>
      </Group>
      {queues.isError && <LoadError error={queues.error} onRetry={() => void queues.refetch()} />}
      <Paper withBorder>
        <Table.ScrollContainer minWidth={560}>
          <Table striped verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Nome</Table.Th>
                <Table.Th>Descrição</Table.Th>
                <Table.Th w={130}>Abertos</Table.Th>
                <Table.Th w={100} aria-label="Ações" />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {queues.isPending && <LoadingRows columns={QUEUE_COLUMNS} rows={2} />}
              {queues.isSuccess && queues.data.length === 0 && <EmptyRow columns={QUEUE_COLUMNS} message="Nenhuma fila cadastrada." />}
              {queues.data?.map((queue) => (
                <Table.Tr key={queue.id}>
                  <Table.Td>
                    <Group gap="xs">
                      <Text size="sm" fw={500}>
                        {queue.name}
                      </Text>
                      {queue.isDefault && (
                        <Badge size="xs" variant="light">
                          Padrão
                        </Badge>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>{queue.description}</Table.Td>
                  <Table.Td>{queue.openCount}</Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap="nowrap" justify="flex-end">
                      <Tooltip label="Editar">
                        <ActionIcon variant="subtle" color="gray" aria-label={`Editar fila ${queue.name}`} onClick={() => setEditing({ queue })}>
                          <IconPencil size={16} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label={queue.isDefault ? 'A fila padrão não pode ser excluída' : 'Excluir'}>
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          aria-label={`Excluir fila ${queue.name}`}
                          disabled={queue.isDefault}
                          onClick={() =>
                            confirmAction({
                              title: 'Excluir fila',
                              message: `Excluir a fila ${queue.name}? Filas com chamados não podem ser excluídas.`,
                              confirmLabel: 'Excluir',
                              danger: true,
                              onConfirm: () => remove.mutate(queue),
                            })
                          }
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
      <Modal opened={editing !== null} onClose={() => setEditing(null)} title={editing?.queue ? 'Editar fila' : 'Nova fila'} centered>
        {editing && <QueueForm key={editing.queue?.id ?? 'nova'} current={editing.queue} onClose={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}

function QueueForm({ current, onClose }: { current: TicketQueueDto | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const form = useForm<SaveTicketQueueRequest>({
    initialValues: { name: current?.name ?? '', description: current?.description ?? '' },
    validate: { name: (v) => (v.trim() ? null : 'Informe o nome da fila') },
  });
  const save = useMutation({
    mutationFn: (body: SaveTicketQueueRequest) => (current ? ticketQueuesApi.update(current.id, body) : ticketQueuesApi.create(body)),
    onSuccess: async () => {
      notifySuccess(current ? 'Fila atualizada.' : 'Fila criada.');
      await queryClient.invalidateQueries({ queryKey: queryKeys.ticketQueues });
      onClose();
    },
    onError: (error) => applyServerErrors(form, error),
  });
  return (
    <form onSubmit={form.onSubmit((v) => save.mutate({ name: v.name.trim(), description: v.description.trim() }))} noValidate>
      <Stack>
        <TextInput label="Nome" required data-autofocus maxLength={100} {...form.getInputProps('name')} />
        <TextInput label="Descrição" {...form.getInputProps('description')} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            {current ? 'Salvar' : 'Criar'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

function SlaPanel() {
  const sla = useQuery({ queryKey: queryKeys.ticketSla, queryFn: ticketsApi.sla });
  return (
    <div>
      <Title order={4}>SLA por prioridade</Title>
      <Text size="sm" c="dimmed" mb="xs">
        Prazos contados a partir da abertura, 24 horas por dia, 7 dias por semana.
      </Text>
      {sla.isError && <LoadError error={sla.error} onRetry={() => void sla.refetch()} />}
      {sla.isPending && <Skeleton height={200} radius="md" />}
      {sla.data && <SlaForm key={sla.dataUpdatedAt} rules={sla.data} />}
    </div>
  );
}

interface SlaRow {
  priority: TicketPriority;
  firstResponseMinutes: number | string;
  resolutionMinutes: number | string;
}

const validMinutes = (v: number | string) => (typeof v === 'number' && Number.isInteger(v) && v >= 1 ? null : 'Informe os minutos');

function SlaForm({ rules }: { rules: SlaRuleDto[] }) {
  const queryClient = useQueryClient();
  const form = useForm<{ rows: SlaRow[] }>({
    initialValues: {
      // Uma linha por prioridade, da mais urgente para a menos urgente.
      rows: [...TICKET_PRIORITIES].reverse().map((priority) => {
        const rule = rules.find((r) => r.priority === priority);
        return { priority, firstResponseMinutes: rule?.firstResponseMinutes ?? 60, resolutionMinutes: rule?.resolutionMinutes ?? 480 };
      }),
    },
    validate: {
      rows: {
        firstResponseMinutes: validMinutes,
        resolutionMinutes: validMinutes,
      },
    },
  });
  const save = useMutation({
    mutationFn: (body: SlaRuleDto[]) => ticketsApi.saveSla(body),
    onSuccess: () => {
      notifySuccess('Prazos de SLA salvos.');
      void queryClient.invalidateQueries({ queryKey: queryKeys.ticketSla });
    },
  });
  const hint = (v: number | string) => (typeof v === 'number' && v > 0 ? formatMinutes(v) : undefined);

  return (
    <Paper withBorder p="lg">
      <form
        onSubmit={form.onSubmit((v) =>
          save.mutate(
            v.rows.map((r) => ({ priority: r.priority, firstResponseMinutes: Number(r.firstResponseMinutes), resolutionMinutes: Number(r.resolutionMinutes) })),
          ),
        )}
        noValidate
      >
        <Stack>
          {form.values.rows.map((row, index) => {
            const label = TICKET_PRIORITY_INFO[row.priority].label;
            return (
              <SimpleGrid key={row.priority} cols={{ base: 1, sm: 3 }} spacing="sm">
                <Group>
                  <Badge color={TICKET_PRIORITY_INFO[row.priority].color} variant="light" size="lg">
                    {label}
                  </Badge>
                </Group>
                <NumberInput
                  label="Primeira resposta (min)"
                  aria-label={`Primeira resposta em minutos, prioridade ${label}`}
                  description={hint(row.firstResponseMinutes)}
                  min={1}
                  allowDecimal={false}
                  {...form.getInputProps(`rows.${index}.firstResponseMinutes`)}
                />
                <NumberInput
                  label="Solução (min)"
                  aria-label={`Solução em minutos, prioridade ${label}`}
                  description={hint(row.resolutionMinutes)}
                  min={1}
                  allowDecimal={false}
                  {...form.getInputProps(`rows.${index}.resolutionMinutes`)}
                />
              </SimpleGrid>
            );
          })}
          <Group justify="flex-end">
            <Button type="submit" loading={save.isPending}>
              Salvar SLA
            </Button>
          </Group>
        </Stack>
      </form>
    </Paper>
  );
}

function IncidentPanel() {
  const settings = useQuery({ queryKey: queryKeys.ticketIncidentSettings, queryFn: ticketsApi.incidentSettings });
  return (
    <div>
      <Title order={4}>Incidentes a partir de alertas</Title>
      <Text size="sm" c="dimmed" mb="xs">
        Abre um chamado do tipo incidente quando um alerta é criado com uma das severidades escolhidas.
      </Text>
      {settings.isError && <LoadError error={settings.error} onRetry={() => void settings.refetch()} />}
      {settings.isPending && <Skeleton height={160} radius="md" />}
      {settings.data && <IncidentForm key={settings.dataUpdatedAt} settings={settings.data} />}
    </div>
  );
}

interface IncidentFormValues {
  enabled: boolean;
  severities: string[];
  priority: TicketPriority;
  queueId: string | null;
  resolveWithAlert: boolean;
}

function IncidentForm({ settings }: { settings: IncidentSettingsDto }) {
  const queryClient = useQueryClient();
  const queues = useQuery({ queryKey: queryKeys.ticketQueues, queryFn: ticketQueuesApi.list });
  const form = useForm<IncidentFormValues>({
    initialValues: {
      enabled: settings.enabled,
      severities: settings.severities,
      priority: settings.priority,
      queueId: settings.queueId === null ? null : String(settings.queueId),
      resolveWithAlert: settings.resolveWithAlert,
    },
    validate: {
      severities: (v, values) => (values.enabled && v.length === 0 ? 'Escolha ao menos uma severidade' : null),
    },
  });
  const save = useMutation({
    mutationFn: (body: IncidentSettingsDto) => ticketsApi.saveIncidentSettings(body),
    onSuccess: (data) => {
      notifySuccess('Regras de incidente salvas.');
      queryClient.setQueryData(queryKeys.ticketIncidentSettings, data);
    },
    onError: (error) => applyServerErrors(form, error),
  });

  return (
    <Paper withBorder p="lg">
      <form
        onSubmit={form.onSubmit((v) =>
          save.mutate({
            enabled: v.enabled,
            severities: v.severities.filter(isSeverity),
            priority: v.priority,
            queueId: v.queueId ? Number(v.queueId) : null,
            resolveWithAlert: v.resolveWithAlert,
          }),
        )}
        noValidate
      >
        <Stack>
          <Switch label="Abrir incidentes automaticamente" {...form.getInputProps('enabled', { type: 'checkbox' })} />
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <MultiSelect label="Severidades" data={SEVERITY_OPTIONS} disabled={!form.values.enabled} {...form.getInputProps('severities')} />
            <Select
              label="Prioridade do incidente"
              data={PRIORITY_OPTIONS}
              allowDeselect={false}
              disabled={!form.values.enabled}
              value={form.values.priority}
              onChange={(v) => {
                if (isTicketPriority(v)) form.setFieldValue('priority', v);
              }}
            />
            <Select
              label="Fila"
              placeholder="Fila padrão"
              clearable
              disabled={!form.values.enabled}
              data={(queues.data ?? []).map((q) => ({ value: String(q.id), label: q.name }))}
              {...form.getInputProps('queueId')}
            />
          </SimpleGrid>
          <Switch
            label="Resolver o incidente junto com o alerta"
            description="Somente quando o incidente ainda não tem técnico atribuído."
            disabled={!form.values.enabled}
            {...form.getInputProps('resolveWithAlert', { type: 'checkbox' })}
          />
          <Group justify="flex-end">
            <Button type="submit" loading={save.isPending}>
              Salvar regras
            </Button>
          </Group>
        </Stack>
      </form>
    </Paper>
  );
}
