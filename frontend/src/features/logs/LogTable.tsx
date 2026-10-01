import { Fragment, useState, type KeyboardEvent } from 'react';
import { Anchor, Code, Group, SimpleGrid, Stack, Table, Text } from '@mantine/core';
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import { Link } from 'react-router';
import type { LogEntryDto } from '../../api/types';
import { agentPath, snmpDevicePath } from '../../app/paths';
import { EmptyRow, LoadingRows } from '../../components/TableStates';
import { formatDateTime } from '../../lib/format';
import { formatLogTime } from './logFormat';
import { LogLevelBadge } from './LogLevelBadge';

interface LogTableProps {
  entries: LogEntryDto[];
  loading: boolean;
  showOrigin: boolean;
  emptyMessage: string;
}

function OriginCell({ entry }: { entry: LogEntryDto }) {
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  if (entry.deviceId !== null) {
    return (
      <Anchor component={Link} to={snmpDevicePath(entry.deviceId)} size="sm" onClick={stop} onKeyDown={stop}>
        {entry.deviceName ?? `Dispositivo ${entry.deviceId}`}
      </Anchor>
    );
  }
  if (entry.agentId !== null) {
    return (
      <Anchor component={Link} to={agentPath(entry.agentId)} size="sm" onClick={stop} onKeyDown={stop}>
        {entry.hostname ?? `Agente ${entry.agentId}`}
      </Anchor>
    );
  }
  return (
    <Text size="sm" c="dimmed" span>
      Desconhecida
    </Text>
  );
}

/** Lista densa de logs; clicar na linha mostra os detalhes e a mensagem completa. */
export function LogTable({ entries, loading, showOrigin, emptyMessage }: LogTableProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const columns = showOrigin ? 6 : 5;
  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const onKeyDown = (e: KeyboardEvent<HTMLTableRowElement>, id: number) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle(id);
    }
  };

  return (
    <Table.ScrollContainer minWidth={showOrigin ? 920 : 760}>
      <Table verticalSpacing={4} highlightOnHover style={{ tableLayout: 'fixed' }} aria-label="Logs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={28} aria-label="Expandir" />
            <Table.Th w={140}>Hora</Table.Th>
            <Table.Th w={120}>Nível</Table.Th>
            {showOrigin && <Table.Th w={180}>Máquina ou dispositivo</Table.Th>}
            <Table.Th w={190}>Origem</Table.Th>
            <Table.Th>Mensagem</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {loading && <LoadingRows columns={columns} />}
          {!loading && entries.length === 0 && <EmptyRow columns={columns} message={emptyMessage} />}
          {entries.map((entry) => {
            const open = expanded.has(entry.id);
            return (
              <Fragment key={entry.id}>
                <Table.Tr
                  tabIndex={0}
                  aria-expanded={open}
                  onClick={() => toggle(entry.id)}
                  onKeyDown={(e) => onKeyDown(e, entry.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <Table.Td>{open ? <IconChevronDown size={14} aria-hidden /> : <IconChevronRight size={14} aria-hidden />}</Table.Td>
                  <Table.Td>
                    <Text size="sm" style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                      {formatLogTime(entry.time)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <LogLevelBadge level={entry.level} />
                  </Table.Td>
                  {showOrigin && (
                    <Table.Td style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <OriginCell entry={entry} />
                    </Table.Td>
                  )}
                  <Table.Td>
                    <Text size="sm" truncate="end" title={entry.source}>
                      {entry.source}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" truncate="end">
                      {entry.message}
                    </Text>
                  </Table.Td>
                </Table.Tr>
                {open && (
                  <Table.Tr>
                    <Table.Td />
                    <Table.Td colSpan={columns - 1}>
                      <Stack gap="xs" py={4}>
                        <SimpleGrid cols={{ base: 1, sm: 4 }} spacing="xs">
                          <Detail label="Log">{entry.log || 'Não informado'}</Detail>
                          <Detail label="Event ID">{entry.eventId ?? 'Não informado'}</Detail>
                          <Detail label="Recebido em">{formatDateTime(entry.receivedAt)}</Detail>
                          <Detail label="Cliente">{entry.clientName ?? 'Não informado'}</Detail>
                        </SimpleGrid>
                        <Code block style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }} aria-label="Mensagem completa">
                          {entry.message}
                        </Code>
                      </Stack>
                    </Table.Td>
                  </Table.Tr>
                )}
              </Fragment>
            );
          })}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

function Detail({ label, children }: { label: string; children: string | number }) {
  return (
    <Group gap={6} wrap="nowrap">
      <Text size="xs" c="dimmed" fw={600}>
        {label}:
      </Text>
      <Text size="xs">{children}</Text>
    </Group>
  );
}
