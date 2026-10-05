import { Badge, Group, Pagination, Paper, Table, Text } from '@mantine/core';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { remoteApi } from '../../api/remote';
import type { RemoteSessionDto } from '../../api/types';
import { EmptyRow, LoadError, LoadingRows } from '../../components/TableStates';
import { formatDateTime, formatDuration, totalPages } from '../../lib/format';
import { endReasonText } from './connection';

const PAGE_SIZE = 50;

function duration(s: RemoteSessionDto): string {
  if (!s.endedAt) return 'Em andamento';
  return formatDuration(Math.max(0, Math.round((Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 1000)), '0 s');
}

function StateBadge({ session }: { session: RemoteSessionDto }) {
  if (session.state !== 'ended') {
    return (
      <Badge color={session.state === 'active' ? 'teal' : 'yellow'} variant="light" size="sm">
        {session.state === 'active' ? 'Ativa' : session.state === 'waiting-consent' ? 'Aguardando o usuário' : 'Iniciando'}
      </Badge>
    );
  }
  return (
    <Text size="sm" c="dimmed">
      {endReasonText(session.endReason)}
    </Text>
  );
}

/** Historico de acessos remotos de um agente ou de um chamado. */
export function RemoteSessionsTable({ agentId, ticketId, showMachine = false }: { agentId?: number; ticketId?: number; showMachine?: boolean }) {
  const [page, setPage] = useState(1);
  const sessions = useQuery({
    queryKey: ['remote-sessions', { agentId, ticketId, page }],
    queryFn: () => remoteApi.sessions({ agentId, ticketId, page }),
    placeholderData: keepPreviousData,
  });
  const rows = sessions.data?.items ?? [];
  const columns = showMachine ? 6 : 5;

  return (
    <>
      {sessions.isError && <LoadError error={sessions.error} onRetry={() => void sessions.refetch()} />}
      <Paper withBorder>
        <Table.ScrollContainer minWidth={640}>
          <Table verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={150}>Início</Table.Th>
                {showMachine && <Table.Th>Máquina</Table.Th>}
                <Table.Th>Técnico</Table.Th>
                <Table.Th w={130}>Tipo</Table.Th>
                <Table.Th w={110}>Duração</Table.Th>
                <Table.Th>Situação</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {sessions.isPending && <LoadingRows columns={columns} rows={3} />}
              {sessions.isSuccess && rows.length === 0 && <EmptyRow columns={columns} message="Nenhum acesso remoto registrado." />}
              {rows.map((s) => (
                <Table.Tr key={s.sessionId}>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(s.startedAt, '')}</Table.Td>
                  {showMachine && <Table.Td>{s.hostname}</Table.Td>}
                  <Table.Td>{s.user}</Table.Td>
                  <Table.Td>
                    <Group gap={4}>
                      {s.channels.includes('desktop') && (
                        <Badge variant="light" size="sm">
                          {s.viewOnly ? 'Visualização' : 'Tela'}
                        </Badge>
                      )}
                      {s.channels.includes('files') && (
                        <Badge variant="light" size="sm" color="grape">
                          Arquivos
                        </Badge>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>{duration(s)}</Table.Td>
                  <Table.Td>
                    <StateBadge session={s} />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
      {sessions.data && sessions.data.total > PAGE_SIZE && (
        <Group justify="flex-end" mt="sm">
          <Pagination value={page} onChange={setPage} total={totalPages(sessions.data.total, PAGE_SIZE)} size="sm" />
        </Group>
      )}
    </>
  );
}

/** Lista curta dos acessos remotos de um chamado (barra lateral); nao aparece quando nao ha acessos. */
export function RemoteSessionsCompact({ ticketId }: { ticketId: number }) {
  const sessions = useQuery({
    queryKey: ['remote-sessions', { ticketId, page: 1 }],
    queryFn: () => remoteApi.sessions({ ticketId, page: 1 }),
  });
  const rows = sessions.data?.items ?? [];
  if (rows.length === 0) return null;
  return (
    <div>
      <Text size="xs" c="dimmed" fw={600} tt="uppercase" mb={4}>
        Acessos remotos
      </Text>
      {rows.slice(0, 5).map((s) => (
        <Text key={s.sessionId} size="sm">
          {formatDateTime(s.startedAt, '')} · {s.user} · {duration(s)}
        </Text>
      ))}
    </div>
  );
}
