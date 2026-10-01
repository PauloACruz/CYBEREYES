import { ActionIcon, Button, Group, NumberInput, Paper, Stack, Table, Text, TextInput, Title, Tooltip } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { queryKeys } from '../../api/queryKeys';
import { ticketsApi } from '../../api/tickets';
import type { CreateTimeEntryRequest, MeDto, TimeEntryDto } from '../../api/types';
import { LoadError } from '../../components/TableStates';
import { confirmAction, notifySuccess } from '../../lib/feedback';
import { applyServerErrors } from '../../lib/forms';
import { formatMinutes } from './ticketFormat';
import { refreshTicketDetail } from './ticketActions';

interface TimeEntriesPanelProps {
  ticketId: number;
  canManage: boolean;
  me: MeDto | undefined;
}

export function TimeEntriesPanel({ ticketId, canManage, me }: TimeEntriesPanelProps) {
  const queryClient = useQueryClient();
  const entries = useQuery({ queryKey: queryKeys.ticketTime(ticketId), queryFn: () => ticketsApi.time(ticketId) });
  const total = (entries.data ?? []).reduce((sum, e) => sum + e.minutes, 0);

  const remove = useMutation({
    mutationFn: (entry: TimeEntryDto) => ticketsApi.removeTime(ticketId, entry.id),
    onSuccess: () => {
      notifySuccess('Apontamento excluído.');
      void queryClient.invalidateQueries({ queryKey: queryKeys.ticketTime(ticketId) });
      refreshTicketDetail(queryClient, ticketId);
    },
  });

  const canDelete = (entry: TimeEntryDto) => canManage && (me?.isSuperuser === true || entry.userId === me?.id);

  return (
    <Paper withBorder p="md" component="section" aria-labelledby="horas-title">
      <Group justify="space-between" mb="xs">
        <Title order={5} id="horas-title">
          Apontamento de horas
        </Title>
        <Text size="sm" fw={600} data-testid="time-total">
          Total: {formatMinutes(total)}
        </Text>
      </Group>
      {entries.isError && <LoadError error={entries.error} onRetry={() => void entries.refetch()} />}
      {entries.isSuccess && entries.data.length === 0 && (
        <Text size="sm" c="dimmed">
          Nenhum apontamento.
        </Text>
      )}
      {entries.isSuccess && entries.data.length > 0 && (
        <Table verticalSpacing={4} fz="sm">
          <Table.Tbody>
            {entries.data.map((entry) => (
              <Table.Tr key={entry.id}>
                <Table.Td>
                  <Text size="sm">{dayjs(entry.workDate).format('DD/MM/YYYY')}</Text>
                  <Text size="xs" c="dimmed">
                    {entry.userName}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{entry.description || 'Sem descrição'}</Text>
                </Table.Td>
                <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>
                  {formatMinutes(entry.minutes)}
                </Table.Td>
                <Table.Td w={36}>
                  {canDelete(entry) && (
                    <Tooltip label="Excluir">
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        size="sm"
                        aria-label={`Excluir apontamento de ${formatMinutes(entry.minutes)}`}
                        onClick={() =>
                          confirmAction({
                            title: 'Excluir apontamento',
                            message: `Excluir o apontamento de ${formatMinutes(entry.minutes)}?`,
                            confirmLabel: 'Excluir',
                            danger: true,
                            onConfirm: () => remove.mutate(entry),
                          })
                        }
                      >
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      {canManage && <AddTimeForm ticketId={ticketId} />}
    </Paper>
  );
}

interface TimeFormValues {
  minutes: number | string;
  description: string;
  workDate: string | null;
}

function AddTimeForm({ ticketId }: { ticketId: number }) {
  const queryClient = useQueryClient();
  const form = useForm<TimeFormValues>({
    initialValues: { minutes: 30, description: '', workDate: dayjs().format('YYYY-MM-DD') },
    validate: {
      minutes: (v) => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 1440 ? null : 'Entre 1 e 1440 minutos'),
    },
  });
  const add = useMutation({
    mutationFn: (body: CreateTimeEntryRequest) => ticketsApi.addTime(ticketId, body),
    onSuccess: () => {
      notifySuccess('Horas apontadas.');
      form.setValues({ minutes: 30, description: '' });
      void queryClient.invalidateQueries({ queryKey: queryKeys.ticketTime(ticketId) });
      refreshTicketDetail(queryClient, ticketId);
    },
    onError: (error) => applyServerErrors(form, error),
  });
  return (
    <form
      onSubmit={form.onSubmit((v) => {
        const body: CreateTimeEntryRequest = { minutes: Number(v.minutes) };
        if (v.description.trim()) body.description = v.description.trim();
        if (v.workDate) body.workDate = v.workDate;
        add.mutate(body);
      })}
      noValidate
    >
      <Stack gap="xs" mt="sm">
        <Group gap="xs" grow align="flex-start">
          <NumberInput label="Minutos" min={1} max={1440} allowDecimal={false} {...form.getInputProps('minutes')} />
          <DateInput label="Data" valueFormat="DD/MM/YYYY" maxDate={dayjs().format('YYYY-MM-DD')} {...form.getInputProps('workDate')} />
        </Group>
        <TextInput label="Descrição" placeholder="O que foi feito" {...form.getInputProps('description')} />
        <Button type="submit" variant="light" leftSection={<IconPlus size={16} />} loading={add.isPending}>
          Adicionar horas
        </Button>
      </Stack>
    </form>
  );
}
