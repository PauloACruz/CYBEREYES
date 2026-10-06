import { Badge, Group, Pagination, Paper, Stack, Switch, Table, Text, Title, Tooltip } from '@mantine/core';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { remoteApi } from '../../api/remote';
import { EmptyRow, LoadError, LoadingRows } from '../../components/TableStates';
import { formatBytes, formatDateTime, totalPages } from '../../lib/format';
import { RemoteSessionsTable } from './RemoteSessionsTable';

const TRANSFER_STATUS = {
  running: { label: 'Em andamento', color: 'blue' },
  done: { label: 'Concluída', color: 'teal' },
  failed: { label: 'Falhou', color: 'red' },
} as const;

function TransfersTable() {
  const [page, setPage] = useState(1);
  const transfers = useQuery({
    queryKey: ['remote-transfers', page],
    queryFn: () => remoteApi.transfers({ page }),
    placeholderData: keepPreviousData,
  });
  const rows = transfers.data?.items ?? [];
  return (
    <>
      {transfers.isError && <LoadError error={transfers.error} onRetry={() => void transfers.refetch()} />}
      <Paper withBorder>
        <Table.ScrollContainer minWidth={760}>
          <Table verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={150}>Início</Table.Th>
                <Table.Th>Máquina</Table.Th>
                <Table.Th>Técnico</Table.Th>
                <Table.Th w={90}>Sentido</Table.Th>
                <Table.Th>Caminho na máquina</Table.Th>
                <Table.Th w={100}>Tamanho</Table.Th>
                <Table.Th w={120}>Situação</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {transfers.isPending && <LoadingRows columns={7} rows={3} />}
              {transfers.isSuccess && rows.length === 0 && <EmptyRow columns={7} message="Nenhuma transferência de arquivo registrada." />}
              {rows.map((t) => (
                <Table.Tr key={t.id}>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(t.startedAt, '')}</Table.Td>
                  <Table.Td>{t.hostname}</Table.Td>
                  <Table.Td>{t.username}</Table.Td>
                  <Table.Td>{t.direction === 'upload' ? 'Envio' : 'Download'}</Table.Td>
                  <Table.Td>
                    <Text size="sm" style={{ wordBreak: 'break-all' }}>
                      {t.remotePath}
                    </Text>
                  </Table.Td>
                  <Table.Td>{t.sizeBytes >= 0 ? formatBytes(t.sizeBytes) : 'zip'}</Table.Td>
                  <Table.Td>
                    <Tooltip label={t.sha256 ? `SHA-256 ${t.sha256}` : (t.error ?? '')} disabled={!t.sha256 && !t.error}>
                      <Badge variant="light" size="sm" color={TRANSFER_STATUS[t.status].color}>
                        {TRANSFER_STATUS[t.status].label}
                      </Badge>
                    </Tooltip>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
      {transfers.data && transfers.data.total > transfers.data.pageSize && (
        <Group justify="flex-end" mt="sm">
          <Pagination value={page} onChange={setPage} total={totalPages(transfers.data.total, transfers.data.pageSize)} size="sm" />
        </Group>
      )}
    </>
  );
}

/** Relatorio do acesso remoto: sessoes de todas as maquinas e transferencias de arquivos. */
export function RemoteReportTab() {
  const [onlyActive, setOnlyActive] = useState(false);
  return (
    <Stack gap="lg">
      <div>
        <Group justify="space-between" mb="xs">
          <Title order={3} size="h5">
            Sessões de acesso remoto
          </Title>
          <Switch size="sm" label="Só as abertas agora" checked={onlyActive} onChange={(e) => setOnlyActive(e.currentTarget.checked)} />
        </Group>
        <RemoteSessionsTable showMachine active={onlyActive ? true : undefined} />
      </div>
      <div>
        <Title order={3} size="h5" mb="xs">
          Transferências de arquivos
        </Title>
        <TransfersTable />
      </div>
    </Stack>
  );
}
