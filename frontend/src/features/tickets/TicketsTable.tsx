import { Anchor, Group, Table, Text } from '@mantine/core';
import { Link } from 'react-router';
import type { TicketListItem } from '../../api/types';
import { agentPath, ticketPath } from '../../app/paths';
import { EmptyRow, LoadingRows } from '../../components/TableStates';
import { RelativeTime } from '../agents/agentDisplay';
import { SlaBreachedIcon, TicketPriorityBadge, TicketStatusBadge, UnreadIcon } from './TicketBadges';

interface TicketsTableProps {
  tickets: TicketListItem[];
  loading: boolean;
  /** Coluna da maquina (oculta na aba do agente). */
  showMachine: boolean;
  emptyMessage: string;
}

export function TicketsTable({ tickets, loading, showMachine, emptyMessage }: TicketsTableProps) {
  const columns = 8 + (showMachine ? 1 : 0);
  return (
    <Table.ScrollContainer minWidth={showMachine ? 1100 : 940}>
      <Table verticalSpacing="xs" highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={80}>Número</Table.Th>
            <Table.Th>Título</Table.Th>
            {showMachine && <Table.Th w={170}>Máquina</Table.Th>}
            <Table.Th w={150}>Solicitante</Table.Th>
            <Table.Th w={120}>Fila</Table.Th>
            <Table.Th w={100}>Prioridade</Table.Th>
            <Table.Th w={170}>Status</Table.Th>
            <Table.Th w={150}>Técnico</Table.Th>
            <Table.Th w={120}>Atualizado</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {loading && <LoadingRows columns={columns} />}
          {!loading && tickets.length === 0 && <EmptyRow columns={columns} message={emptyMessage} />}
          {tickets.map((ticket) => (
            <Table.Tr key={ticket.id}>
              <Table.Td>
                <Text size="sm" c="dimmed" ff="monospace">
                  #{ticket.id}
                </Text>
              </Table.Td>
              <Table.Td>
                <Group gap={6} wrap="nowrap">
                  {ticket.slaBreached && <SlaBreachedIcon />}
                  {ticket.unreadForTechnician && <UnreadIcon />}
                  <Anchor component={Link} to={ticketPath(ticket.id)} size="sm" fw={ticket.unreadForTechnician ? 700 : 500} lineClamp={2}>
                    {ticket.title}
                  </Anchor>
                </Group>
              </Table.Td>
              {showMachine && (
                <Table.Td>
                  {ticket.agentId !== null && ticket.hostname ? (
                    <>
                      <Anchor component={Link} to={agentPath(ticket.agentId)} size="sm">
                        {ticket.hostname}
                      </Anchor>
                      {ticket.clientName && (
                        <Text size="xs" c="dimmed">
                          {ticket.clientName}
                          {ticket.siteName ? ` / ${ticket.siteName}` : ''}
                        </Text>
                      )}
                    </>
                  ) : (
                    <Text size="sm" c="dimmed">
                      Sem máquina
                    </Text>
                  )}
                </Table.Td>
              )}
              <Table.Td>
                <Text size="sm">{ticket.requesterName}</Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm">{ticket.queueName}</Text>
              </Table.Td>
              <Table.Td>
                <TicketPriorityBadge priority={ticket.priority} />
              </Table.Td>
              <Table.Td>
                <TicketStatusBadge status={ticket.status} />
              </Table.Td>
              <Table.Td>
                {ticket.assignedToName ? (
                  <Text size="sm">{ticket.assignedToName}</Text>
                ) : (
                  <Text size="sm" c="dimmed">
                    Sem técnico
                  </Text>
                )}
              </Table.Td>
              <Table.Td>
                <RelativeTime value={ticket.updatedAt} />
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
