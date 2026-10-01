import { Fragment, useMemo, useState } from 'react';
import { ActionIcon, Badge, Button, Collapse, Group, NumberInput, Paper, Select, Table, Text, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconChevronDown, IconChevronRight, IconRefresh, IconSearch } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { agentActionsApi } from '../../../api/agentActions';
import { queryKeys } from '../../../api/queryKeys';
import type { AgentDetail, EventLogEntry, EventLogName } from '../../../api/types';
import { EmptyRow, LoadError, LoadingRows } from '../../../components/TableStates';
import { formatDateTime } from '../../../lib/format';

const LOGS: readonly { value: EventLogName; label: string }[] = [
  { value: 'Application', label: 'Aplicativo (Application)' },
  { value: 'System', label: 'Sistema (System)' },
  { value: 'Security', label: 'Segurança (Security)' },
];

const TYPE_INFO: Record<string, { label: string; color: string }> = {
  error: { label: 'Erro', color: 'red' },
  warning: { label: 'Aviso', color: 'orange' },
  information: { label: 'Informação', color: 'blue' },
  info: { label: 'Informação', color: 'blue' },
  audit_success: { label: 'Auditoria com êxito', color: 'teal' },
  auditsuccess: { label: 'Auditoria com êxito', color: 'teal' },
  audit_failure: { label: 'Falha de auditoria', color: 'grape' },
  auditfailure: { label: 'Falha de auditoria', color: 'grape' },
};

function typeKey(eventType: string): string {
  return eventType.toLowerCase().replace(/\s+/g, '_');
}

function typeInfo(eventType: string): { label: string; color: string } {
  return TYPE_INFO[typeKey(eventType)] ?? { label: eventType || 'Desconhecido', color: 'gray' };
}

const COLUMNS = 5;
const PAGE = 200;

export function EventLogTab({ agent }: { agent: AgentDetail }) {
  const [log, setLog] = useState<EventLogName>('Application');
  const [daysInput, setDaysInput] = useState<number>(1);
  const [days] = useDebouncedValue(Math.min(30, Math.max(1, Number.isInteger(daysInput) ? daysInput : 1)), 400);
  const [type, setType] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [limit, setLimit] = useState(PAGE);

  const events = useQuery({
    queryKey: queryKeys.agentEventLog(agent.id, log, days),
    queryFn: () => agentActionsApi.eventLog(agent.id, log, days),
    retry: false,
  });

  const typeOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of events.data ?? []) {
      const key = typeKey(e.eventType);
      if (!seen.has(key)) seen.set(key, typeInfo(e.eventType).label);
    }
    return [...seen].map(([value, label]) => ({ value, label }));
  }, [events.data]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (events.data ?? []).filter(
      (e: EventLogEntry) =>
        (!type || typeKey(e.eventType) === type) &&
        (!term || e.message.toLowerCase().includes(term) || e.source.toLowerCase().includes(term) || String(e.eventId) === term),
    );
  }, [events.data, type, search]);

  return (
    <>
      <Group mb="md" align="flex-end" wrap="wrap" gap="sm">
        <Select
          label="Log"
          data={LOGS}
          value={log}
          onChange={(value) => {
            if (value) setLog(value);
            setExpanded(null);
            setLimit(PAGE);
          }}
          allowDeselect={false}
          w={220}
        />
        <NumberInput
          label="Últimos dias"
          min={1}
          max={30}
          allowDecimal={false}
          clampBehavior="strict"
          value={daysInput}
          onChange={(value) => setDaysInput(typeof value === 'number' ? value : 1)}
          w={120}
        />
        <Select
          label="Tipo"
          placeholder="Todos"
          clearable
          data={typeOptions}
          value={type}
          onChange={(value) => {
            setType(value);
            setExpanded(null);
            setLimit(PAGE);
          }}
          w={200}
        />
        <TextInput
          label="Busca"
          placeholder="Origem, ID ou mensagem"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => {
            setSearch(e.currentTarget.value);
            setExpanded(null);
            setLimit(PAGE);
          }}
          w={260}
        />
        <Button variant="light" leftSection={<IconRefresh size={16} />} loading={events.isFetching} onClick={() => void events.refetch()}>
          Atualizar
        </Button>
      </Group>
      {events.isError && <LoadError error={events.error} onRetry={() => void events.refetch()} />}
      {events.data && (
        <Text size="sm" c="dimmed" mb="xs">
          {rows.length} de {events.data.length} eventos
        </Text>
      )}
      <Paper withBorder>
        <Table.ScrollContainer minWidth={760}>
          <Table verticalSpacing="xs" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={40} aria-label="Expandir" />
                <Table.Th w={150}>Data e hora</Table.Th>
                <Table.Th w={170}>Tipo</Table.Th>
                <Table.Th>Origem</Table.Th>
                <Table.Th w={100}>ID</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {events.isPending && <LoadingRows columns={COLUMNS} />}
              {events.isSuccess && rows.length === 0 && <EmptyRow columns={COLUMNS} message="Nenhum evento encontrado." />}
              {rows.slice(0, limit).map((event, index) => {
                const info = typeInfo(event.eventType);
                const open = expanded === index;
                return (
                  <Fragment key={`${event.time}-${event.eventId}-${index}`}>
                    <Table.Tr style={{ cursor: 'pointer' }} onClick={() => setExpanded(open ? null : index)}>
                      <Table.Td>
                        <ActionIcon variant="subtle" color="gray" size="sm" aria-label={open ? 'Recolher mensagem' : 'Expandir mensagem'} aria-expanded={open}>
                          {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                        </ActionIcon>
                      </Table.Td>
                      <Table.Td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(event.time, '')}</Table.Td>
                      <Table.Td>
                        <Badge variant="light" size="sm" color={info.color}>
                          {info.label}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" fw={500}>
                          {event.source}
                        </Text>
                        {!open && (
                          <Text size="xs" c="dimmed" lineClamp={1}>
                            {event.message}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td ff="monospace">{event.eventId}</Table.Td>
                    </Table.Tr>
                    {open && (
                      <Table.Tr>
                        <Table.Td colSpan={COLUMNS}>
                          <Collapse expanded={open}>
                            <Text size="sm" style={{ whiteSpace: 'pre-wrap' }} ff="monospace">
                              {event.message || 'Sem mensagem.'}
                            </Text>
                          </Collapse>
                        </Table.Td>
                      </Table.Tr>
                    )}
                  </Fragment>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
      {rows.length > limit && (
        <Group justify="center" mt="md">
          <Button variant="default" onClick={() => setLimit(limit + PAGE)}>
            Mostrar mais {Math.min(PAGE, rows.length - limit)} eventos
          </Button>
        </Group>
      )}
    </>
  );
}
