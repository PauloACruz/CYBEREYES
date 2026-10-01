import { useState } from 'react';
import { Button, Group, Modal, Select, SimpleGrid, Stack, Textarea, TextInput, type ComboboxItem } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useDebouncedValue } from '@mantine/hooks';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { agentsApi } from '../../api/agents';
import { queryKeys } from '../../api/queryKeys';
import { ticketQueuesApi, ticketsApi } from '../../api/tickets';
import { PERMISSIONS, type CreateTicketRequest, type TicketPriority, type TicketType } from '../../api/types';
import { ticketPath } from '../../app/paths';
import { hasPermission } from '../../auth/permissions';
import { useMe } from '../../auth/useMe';
import { notifySuccess } from '../../lib/feedback';
import { applyServerErrors } from '../../lib/forms';
import { isTicketPriority, isTicketType, PRIORITY_OPTIONS, TYPE_OPTIONS } from './ticketFormat';

export interface TicketAgentRef {
  id: number;
  hostname: string;
  loggedInUsername?: string | null;
}

interface CreateTicketModalProps {
  opened: boolean;
  onClose: () => void;
  /** Maquina ja escolhida (aba Chamados do agente). */
  agent?: TicketAgentRef;
}

export function CreateTicketModal({ opened, onClose, agent }: CreateTicketModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} title="Novo chamado" size="lg" centered>
      {opened && <CreateTicketForm onClose={onClose} agent={agent} />}
    </Modal>
  );
}

interface FormValues {
  title: string;
  description: string;
  type: TicketType;
  priority: TicketPriority;
  queueId: string | null;
  agentId: string | null;
  requesterName: string;
  requesterEmail: string;
  assignedToId: string | null;
}

const AGENT_SEARCH_SIZE = 20;

/** Usuario do sistema operacional informado pelo agente ("None" quando ninguem esta logado). */
function usableUsername(value: string | null | undefined): string {
  return value && value !== 'None' ? value : '';
}

function buildBody(v: FormValues): CreateTicketRequest {
  const body: CreateTicketRequest = {
    title: v.title.trim(),
    description: v.description.trim(),
    type: v.type,
    priority: v.priority,
  };
  if (v.queueId) body.queueId = Number(v.queueId);
  if (v.agentId) body.agentId = Number(v.agentId);
  if (v.requesterName.trim()) body.requesterName = v.requesterName.trim();
  if (v.requesterEmail.trim()) body.requesterEmail = v.requesterEmail.trim();
  if (v.assignedToId) body.assignedToId = v.assignedToId;
  return body;
}

function CreateTicketForm({ onClose, agent }: { onClose: () => void; agent?: TicketAgentRef }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: me } = useMe();
  const canSearchAgents = hasPermission(me, PERMISSIONS.agentsView);
  const queues = useQuery({ queryKey: queryKeys.ticketQueues, queryFn: ticketQueuesApi.list });
  const assignees = useQuery({ queryKey: queryKeys.ticketAssignees, queryFn: ticketsApi.assignees });

  const [agentSearch, setAgentSearch] = useState('');
  const [debouncedSearch] = useDebouncedValue(agentSearch.trim(), 300);
  const [knownAgents, setKnownAgents] = useState<Record<string, TicketAgentRef>>(() => (agent ? { [String(agent.id)]: agent } : {}));
  const agentParams = { page: 1, pageSize: AGENT_SEARCH_SIZE, search: debouncedSearch || undefined };
  const agents = useQuery({
    queryKey: queryKeys.agentList(agentParams),
    queryFn: () => agentsApi.list(agentParams),
    enabled: canSearchAgents && !agent,
    placeholderData: keepPreviousData,
  });

  const form = useForm<FormValues>({
    initialValues: {
      title: '',
      description: '',
      type: 'request',
      priority: 'medium',
      queueId: null,
      agentId: agent ? String(agent.id) : null,
      requesterName: usableUsername(agent?.loggedInUsername),
      requesterEmail: '',
      assignedToId: null,
    },
    validate: {
      title: (v) => {
        const len = v.trim().length;
        if (len < 3) return 'Informe um título com pelo menos 3 caracteres';
        return len > 200 ? 'Use no máximo 200 caracteres' : null;
      },
      description: (v) => (v.length > 20000 ? 'Use no máximo 20000 caracteres' : null),
      requesterEmail: (v) => (!v.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? null : 'E-mail inválido'),
    },
  });

  const create = useMutation({
    mutationFn: (body: CreateTicketRequest) => ticketsApi.create(body),
    onSuccess: async (ticket) => {
      notifySuccess(`Chamado #${ticket.id} criado.`);
      queryClient.setQueryData(queryKeys.ticketDetail(ticket.id), ticket);
      void queryClient.invalidateQueries({ queryKey: queryKeys.ticketLists });
      void queryClient.invalidateQueries({ queryKey: queryKeys.ticketSummary });
      void queryClient.invalidateQueries({ queryKey: queryKeys.agentTicketLists });
      onClose();
      await navigate(ticketPath(ticket.id));
    },
    onError: (error) => applyServerErrors(form, error),
  });

  const agentOptions: ComboboxItem[] = Object.values(knownAgents).map((a) => ({ value: String(a.id), label: a.hostname }));
  for (const a of agents.data?.items ?? []) {
    if (!knownAgents[String(a.id)]) agentOptions.push({ value: String(a.id), label: a.hostname });
  }

  const selectAgent = (value: string | null) => {
    form.setFieldValue('agentId', value);
    if (!value) return;
    const found = agents.data?.items.find((a) => String(a.id) === value);
    if (!found) return;
    setKnownAgents({ [value]: { id: found.id, hostname: found.hostname, loggedInUsername: found.loggedInUsername } });
    const username = usableUsername(found.loggedInUsername);
    if (!form.values.requesterName.trim() && username) form.setFieldValue('requesterName', username);
  };

  return (
    <form onSubmit={form.onSubmit((values) => create.mutate(buildBody(values)))} noValidate>
      <Stack>
        <TextInput label="Título" required data-autofocus maxLength={200} {...form.getInputProps('title')} />
        <Textarea label="Descrição" autosize minRows={4} maxRows={12} {...form.getInputProps('description')} />
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <Select
            label="Tipo"
            data={TYPE_OPTIONS}
            allowDeselect={false}
            value={form.values.type}
            onChange={(v) => {
              if (isTicketType(v)) form.setFieldValue('type', v);
            }}
          />
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
        </SimpleGrid>
        {(agent || canSearchAgents) && (
          <Select
            label="Máquina"
            placeholder={agent ? undefined : 'Buscar por hostname, usuário ou IP'}
            description={agent ? undefined : 'Opcional'}
            searchable={!agent}
            clearable={!agent}
            disabled={Boolean(agent)}
            nothingFoundMessage={agents.isFetching ? 'Buscando...' : 'Nenhuma máquina encontrada'}
            filter={({ options }) => options}
            searchValue={agent ? undefined : agentSearch}
            onSearchChange={agent ? undefined : setAgentSearch}
            data={agentOptions}
            value={form.values.agentId}
            onChange={selectAgent}
          />
        )}
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label="Solicitante" placeholder="Nome de quem pediu o atendimento" maxLength={200} {...form.getInputProps('requesterName')} />
          <TextInput label="E-mail do solicitante" type="email" {...form.getInputProps('requesterEmail')} />
        </SimpleGrid>
        <Select
          label="Técnico"
          placeholder="Sem técnico"
          clearable
          searchable
          data={(assignees.data ?? []).map((u) => ({ value: u.id, label: u.name }))}
          {...form.getInputProps('assignedToId')}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={create.isPending}>
            Criar chamado
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
