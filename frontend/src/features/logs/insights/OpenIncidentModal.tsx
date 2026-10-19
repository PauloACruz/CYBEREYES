import { Button, Group, Modal, Select, SimpleGrid, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../../api/queryKeys';
import { ticketQueuesApi, ticketsApi } from '../../../api/tickets';
import type { CreateTicketRequest, LogInsightDetailDto, LogInsightItem, LogInsightMachine, TicketPriority } from '../../../api/types';
import { notifySuccess } from '../../../lib/feedback';
import { applyServerErrors } from '../../../lib/forms';
import { isTicketPriority, PRIORITY_OPTIONS } from '../../tickets/ticketFormat';
import { INCIDENT_PRIORITY, incidentDescription, machinePlace } from './insightFormat';

/** Solicitante dos incidentes abertos pela analise: ninguem da maquina, entao o chamado fica interno. */
export const INCIDENT_REQUESTER = 'Análise da IA';

export interface IncidentTarget {
  item: LogInsightItem;
  machine: LogInsightMachine & { agentId: number };
}

interface Props {
  report: Pick<LogInsightDetailDto, 'id' | 'windowStart' | 'windowEnd'>;
  target: IncidentTarget | null;
  onClose: () => void;
  onCreated: (target: IncidentTarget, ticketId: number) => void;
}

export function OpenIncidentModal({ report, target, onClose, onCreated }: Props) {
  return (
    <Modal opened={target !== null} onClose={onClose} title="Abrir incidente" size="lg" centered>
      {target && <IncidentForm report={report} target={target} onClose={onClose} onCreated={onCreated} />}
    </Modal>
  );
}

interface FormValues {
  title: string;
  description: string;
  priority: TicketPriority;
  queueId: string | null;
  assignedToId: string | null;
}

function IncidentForm({ report, target, onClose, onCreated }: Props & { target: IncidentTarget }) {
  const queryClient = useQueryClient();
  const queues = useQuery({ queryKey: queryKeys.ticketQueues, queryFn: ticketQueuesApi.list });
  const assignees = useQuery({ queryKey: queryKeys.ticketAssignees, queryFn: ticketsApi.assignees });
  const { item, machine } = target;
  const place = machinePlace(machine);

  const form = useForm<FormValues>({
    initialValues: {
      title: `[${machine.hostname}] ${item.title}`.slice(0, 200),
      description: incidentDescription(report, item, machine),
      priority: INCIDENT_PRIORITY[item.severity],
      queueId: null,
      assignedToId: null,
    },
    validate: {
      title: (v) => (v.trim().length < 3 ? 'Informe um título com pelo menos 3 caracteres' : null),
      description: (v) => (v.length > 20000 ? 'Use no máximo 20000 caracteres' : null),
    },
  });

  const create = useMutation({
    mutationFn: (values: FormValues) => {
      const body: CreateTicketRequest = {
        title: values.title.trim(),
        description: values.description.trim(),
        type: 'incident',
        priority: values.priority,
        agentId: machine.agentId,
        requesterName: INCIDENT_REQUESTER,
      };
      if (values.queueId) body.queueId = Number(values.queueId);
      if (values.assignedToId) body.assignedToId = values.assignedToId;
      return ticketsApi.create(body);
    },
    onSuccess: (ticket) => {
      notifySuccess(`Incidente #${ticket.id} aberto em ${machine.hostname}.`);
      queryClient.setQueryData(queryKeys.ticketDetail(ticket.id), ticket);
      void queryClient.invalidateQueries({ queryKey: queryKeys.ticketLists });
      void queryClient.invalidateQueries({ queryKey: queryKeys.ticketSummary });
      void queryClient.invalidateQueries({ queryKey: queryKeys.agentTicketLists });
      onCreated(target, ticket.id);
      onClose();
    },
    onError: (error) => applyServerErrors(form, error),
  });

  return (
    <form onSubmit={form.onSubmit((values) => create.mutate(values))} noValidate>
      <Stack>
        <Text size="sm" c="dimmed">
          Incidente interno em <b>{machine.hostname}</b>
          {place ? ` (${place})` : ''}: segue como um chamado, mas não aparece para o usuário da máquina e as mensagens ficam só entre os técnicos.
        </Text>
        <TextInput label="Título" required data-autofocus maxLength={200} {...form.getInputProps('title')} />
        <Textarea label="Descrição" autosize minRows={6} maxRows={14} {...form.getInputProps('description')} />
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <Select
            label="Prioridade"
            data={PRIORITY_OPTIONS}
            allowDeselect={false}
            value={form.values.priority}
            onChange={(v) => {
              if (isTicketPriority(v)) form.setFieldValue('priority', v);
            }}
          />
          <Select
            label="Fila"
            placeholder="Fila padrão"
            clearable
            data={(queues.data ?? []).map((q) => ({ value: String(q.id), label: q.name }))}
            {...form.getInputProps('queueId')}
          />
          <Select
            label="Técnico"
            placeholder="Sem técnico"
            clearable
            searchable
            data={(assignees.data ?? []).map((u) => ({ value: u.id, label: u.name }))}
            {...form.getInputProps('assignedToId')}
          />
        </SimpleGrid>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" color="red" loading={create.isPending}>
            Abrir incidente
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
