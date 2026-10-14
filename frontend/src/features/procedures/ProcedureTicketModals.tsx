import { useState } from 'react';
import { Button, Checkbox, Group, Modal, NumberInput, ScrollArea, Select, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router';
import { proceduresApi } from '../../api/procedures';
import { queryKeys } from '../../api/queryKeys';
import { ticketsApi } from '../../api/tickets';
import type { ProcedureDto, TicketDetail, TicketPriority } from '../../api/types';
import { ticketPath } from '../../app/paths';
import { ApiErrorAlert } from '../../components/ApiErrorAlert';
import { notifySuccess } from '../../lib/feedback';
import { formatDateTime } from '../../lib/format';
import { PRIORITY_OPTIONS } from '../tickets/ticketFormat';
import { formatTotalSeconds, PROCEDURE_KIND_INFO, procedureDuration, suggestedMinutes } from './procedureFormat';

function describe(p: ProcedureDto): string {
  const label = PROCEDURE_KIND_INFO[p.kind].label;
  return p.title ? `${label}: ${p.title}` : label;
}

/** Minutos de servico de cada procedimento, comecando pela duracao arredondada. */
function MinutesList({ procedures, minutes, onChange }: { procedures: ProcedureDto[]; minutes: Record<number, number | string>; onChange: (id: number, value: number | string) => void }) {
  return (
    <Stack gap="xs">
      {procedures.map((p) => (
        <Group key={p.id} gap="sm" wrap="nowrap" align="flex-end">
          <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
            <Text size="sm" truncate title={describe(p)}>
              {describe(p)}
            </Text>
            <Text size="xs" c="dimmed">
              {p.hostname} · {formatDateTime(p.startedAt, '')} · durou {procedureDuration(p)}
            </Text>
          </Stack>
          <NumberInput
            aria-label={`Minutos de serviço: ${describe(p)}`}
            w={110}
            min={1}
            max={1440}
            allowDecimal={false}
            suffix=" min"
            value={minutes[p.id] ?? suggestedMinutes(p)}
            onChange={(value) => onChange(p.id, value)}
          />
        </Group>
      ))}
    </Stack>
  );
}

function validMinutes(value: number | string | undefined): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 1440;
}

interface ModalProps {
  procedures: ProcedureDto[];
  opened: boolean;
  onClose: () => void;
  onDone: () => void;
}

/** Inclui os procedimentos escolhidos num chamado aberto: cada um vira um apontamento com o tempo de servico. */
export function IncludeInTicketModal({ procedures, opened, onClose, onDone }: ModalProps) {
  const queryClient = useQueryClient();
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search.trim(), 300);
  const [minutes, setMinutes] = useState<Record<number, number | string>>({});
  const agentIds = [...new Set(procedures.map((p) => p.agentId))];
  const agentId = agentIds.length === 1 && agentIds[0] !== null ? agentIds[0] : undefined;
  const params = { page: 1, pageSize: 30, open: true, agentId, search: debounced || undefined };
  const tickets = useQuery({ queryKey: queryKeys.ticketList(params), queryFn: () => ticketsApi.list(params), enabled: opened });
  const values = procedures.map((p) => minutes[p.id] ?? suggestedMinutes(p));
  const valid = ticketId !== null && values.every(validMinutes);

  const include = useMutation({
    mutationFn: (id: number) =>
      proceduresApi.include(id, { items: procedures.map((p, i) => ({ procedureId: p.id, minutes: Number(values[i]) })) }),
    onSuccess: (_, id) => {
      notifySuccess(procedures.length === 1 ? `Procedimento incluído no chamado #${id}.` : `${procedures.length} procedimentos incluídos no chamado #${id}.`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.procedures });
      void queryClient.invalidateQueries({ queryKey: queryKeys.ticketDetail(id) });
      setTicketId(null);
      setMinutes({});
      onDone();
    },
  });

  return (
    <Modal opened={opened} onClose={onClose} title="Incluir em chamado" size="lg">
      <Stack gap="md">
        <Select
          label="Chamado aberto"
          description={agentId !== undefined ? 'Chamados abertos desta máquina.' : 'Chamados abertos do mesmo cliente.'}
          placeholder="Busque pelo número ou título"
          searchable
          searchValue={search}
          onSearchChange={setSearch}
          nothingFoundMessage={tickets.isFetching ? 'Buscando...' : 'Nenhum chamado aberto encontrado'}
          data={(tickets.data?.items ?? []).map((t) => ({ value: String(t.id), label: `#${t.id} ${t.title}${t.hostname ? ` (${t.hostname})` : ''}` }))}
          value={ticketId}
          onChange={setTicketId}
          filter={({ options }) => options}
          required
        />
        <Stack gap={6}>
          <Text size="sm" fw={500}>
            Tempo de serviço
          </Text>
          <Text size="xs" c="dimmed">
            Começa pela duração de cada procedimento; ajuste se o atendimento levou mais ou menos tempo.
          </Text>
          <MinutesList procedures={procedures} minutes={minutes} onChange={(id, value) => setMinutes((m) => ({ ...m, [id]: value }))} />
        </Stack>
        {include.isError && <ApiErrorAlert error={include.error} />}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={!valid} loading={include.isPending} onClick={() => ticketId && include.mutate(Number(ticketId))}>
            Incluir
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** Atendimento feito sem chamado: cria o chamado com os procedimentos e o tempo deles, atribuido a quem registra. */
export function RegisterTicketModal({ procedures, opened, onClose, onDone }: ModalProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const hosts = [...new Set(procedures.map((p) => p.hostname))];
  const seconds = procedures.reduce((sum, p) => sum + (p.durationSeconds ?? 0), 0);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('low');
  const [resolve, setResolve] = useState(true);
  const defaultTitle = hosts.length === 1 ? `Atendimento em ${hosts[0]}` : `Atendimento em ${hosts.length} máquinas`;
  const defaultDescription = procedures.map((p) => `- ${describe(p)} em ${p.hostname} (${procedureDuration(p)})`).join('\n');
  const finalTitle = (title || defaultTitle).trim();

  const create = useMutation({
    mutationFn: () =>
      proceduresApi.createTicket({
        procedureIds: procedures.map((p) => p.id),
        title: finalTitle,
        description: (description || defaultDescription).trim() || undefined,
        priority,
        resolve,
      }),
    onSuccess: ({ id }) => {
      notifySuccess(`Chamado #${id} registrado com ${procedures.length === 1 ? 'o procedimento' : `${procedures.length} procedimentos`}.`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.procedures });
      void queryClient.invalidateQueries({ queryKey: queryKeys.tickets });
      onDone();
      void navigate(ticketPath(id));
    },
  });

  return (
    <Modal opened={opened} onClose={onClose} title="Registrar como chamado" size="lg">
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          Cria um chamado atribuído a você com {procedures.length === 1 ? 'este procedimento' : `estes ${procedures.length} procedimentos`} (
          {formatTotalSeconds(seconds)} de execução). O tempo de serviço de cada um começa pela duração, arredondada para cima.
        </Text>
        <TextInput label="Título" required value={title || defaultTitle} onChange={(e) => setTitle(e.currentTarget.value)} maxLength={200} />
        <Textarea
          label="Descrição"
          autosize
          minRows={3}
          maxRows={8}
          value={description || defaultDescription}
          onChange={(e) => setDescription(e.currentTarget.value)}
        />
        <Select
          label="Prioridade"
          data={PRIORITY_OPTIONS}
          value={priority}
          onChange={(v) => v && setPriority(v)}
          allowDeselect={false}
          w={200}
        />
        <Checkbox label="Já marcar como resolvido" checked={resolve} onChange={(e) => setResolve(e.currentTarget.checked)} />
        {create.isError && <ApiErrorAlert error={create.error} />}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={finalTitle.length < 3} loading={create.isPending} onClick={() => create.mutate()}>
            Registrar chamado
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/**
 * Escolhe procedimentos sem chamado (ultimos 30 dias) para incluir neste chamado: os da maquina do chamado ou, sem maquina, os do
 * mesmo cliente.
 */
export function PickProceduresModal({ ticket, opened, onClose }: { ticket: TicketDetail; opened: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [minutes, setMinutes] = useState<Record<number, number | string>>({});
  const params = {
    agentId: ticket.agentId ?? undefined,
    linked: false,
    from: dayjs().subtract(30, 'day').format('YYYY-MM-DD'),
    page: 1,
    pageSize: 100,
  };
  const procedures = useQuery({ queryKey: queryKeys.procedureList(params), queryFn: () => proceduresApi.list(params), enabled: opened });
  const options = (procedures.data?.items ?? []).filter(
    (p) => p.status !== 'running' && (ticket.agentId !== null || !ticket.clientName || p.clientName === ticket.clientName),
  );
  const chosen = options.filter((p) => selected.has(p.id));
  const values = chosen.map((p) => minutes[p.id] ?? suggestedMinutes(p));
  const valid = chosen.length > 0 && values.every(validMinutes);

  const include = useMutation({
    mutationFn: () => proceduresApi.include(ticket.id, { items: chosen.map((p, i) => ({ procedureId: p.id, minutes: Number(values[i]) })) }),
    onSuccess: () => {
      notifySuccess(chosen.length === 1 ? 'Procedimento incluído no chamado.' : `${chosen.length} procedimentos incluídos no chamado.`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.procedures });
      void queryClient.invalidateQueries({ queryKey: queryKeys.ticketDetail(ticket.id) });
      setSelected(new Set());
      setMinutes({});
      onClose();
    },
  });

  return (
    <Modal opened={opened} onClose={onClose} title="Incluir procedimentos no chamado" size="lg">
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          {ticket.agentId !== null ? `Procedimentos em ${ticket.hostname} ` : 'Procedimentos do cliente '}
          dos últimos 30 dias que ainda não estão em nenhum chamado. Cada um vira um apontamento de horas com o tempo de serviço.
        </Text>
        {procedures.isError && <ApiErrorAlert error={procedures.error} />}
        {procedures.isSuccess && options.length === 0 && (
          <Text size="sm" c="dimmed" ta="center" py="md">
            Nenhum procedimento sem chamado nos últimos 30 dias.
          </Text>
        )}
        <ScrollArea.Autosize mah={360} type="auto">
          <Stack gap={6}>
            {options.map((p) => (
              <Checkbox
                key={p.id}
                checked={selected.has(p.id)}
                onChange={(e) => {
                  const next = new Set(selected);
                  if (e.currentTarget.checked) next.add(p.id);
                  else next.delete(p.id);
                  setSelected(next);
                }}
                label={describe(p)}
                description={`${p.hostname} · ${formatDateTime(p.startedAt, '')} · ${p.userName} · durou ${procedureDuration(p)}`}
              />
            ))}
          </Stack>
        </ScrollArea.Autosize>
        {chosen.length > 0 && (
          <Stack gap={6}>
            <Text size="sm" fw={500}>
              Tempo de serviço
            </Text>
            <MinutesList procedures={chosen} minutes={minutes} onChange={(id, value) => setMinutes((m) => ({ ...m, [id]: value }))} />
          </Stack>
        )}
        {include.isError && <ApiErrorAlert error={include.error} />}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={!valid} loading={include.isPending} onClick={() => include.mutate()}>
            {chosen.length > 1 ? `Incluir ${chosen.length}` : 'Incluir'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
