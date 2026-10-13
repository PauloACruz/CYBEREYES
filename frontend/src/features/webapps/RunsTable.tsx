import { useState } from 'react';
import { Anchor, Group, Modal, Pagination, Paper, Table, Text } from '@mantine/core';
import { IconRocket } from '@tabler/icons-react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import type { AppRunKind, ListAppRunsParams } from '../../api/types';
import { appRunsApi } from '../../api/webapps';
import { EmptyRow, LoadError, LoadingRows } from '../../components/TableStates';
import { formatDateTime, totalPages } from '../../lib/format';
import { RunOutput } from './RunOutput';
import { RunStatusBadge } from './WebAppStatusBadge';

const COLUMNS = 6;
const PAGE_SIZE = 15;

interface RunsTableProps {
  serverId?: number;
  webAppId?: number;
  kind?: AppRunKind;
  canCancel: boolean;
}

/** Historico de comandos e deploys; o clique abre a saida completa. */
export function RunsTable({ serverId, webAppId, kind, canCancel }: RunsTableProps) {
  const [page, setPage] = useState(1);
  const [openRun, setOpenRun] = useState<number | null>(null);
  const params: ListAppRunsParams = { serverId, webAppId, kind, page, pageSize: PAGE_SIZE };
  const runs = useQuery({ queryKey: queryKeys.appRunList(params), queryFn: () => appRunsApi.list(params), placeholderData: keepPreviousData });
  const pages = runs.data ? totalPages(runs.data.total, PAGE_SIZE) : 1;

  return (
    <>
      {runs.isError && <LoadError error={runs.error} onRetry={() => void runs.refetch()} />}
      <Paper withBorder style={{ opacity: runs.isPlaceholderData ? 0.6 : 1 }}>
        <Table.ScrollContainer minWidth={760}>
          <Table striped highlightOnHover verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={130}>Resultado</Table.Th>
                <Table.Th>Comando</Table.Th>
                <Table.Th w={180}>Onde</Table.Th>
                <Table.Th w={160}>Quem</Table.Th>
                <Table.Th w={160}>Início</Table.Th>
                <Table.Th w={90}>Código</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {runs.isPending && <LoadingRows columns={COLUMNS} />}
              {runs.data?.items.length === 0 && <EmptyRow columns={COLUMNS} message="Nenhum comando ou deploy executado ainda." />}
              {runs.data?.items.map((run) => (
                <Table.Tr key={run.id}>
                  <Table.Td>
                    <RunStatusBadge status={run.status} />
                  </Table.Td>
                  <Table.Td>
                    <Group gap={6} wrap="nowrap">
                      {run.kind === 'deploy' && <IconRocket size={14} aria-label="Deploy" />}
                      <Anchor component="button" type="button" size="sm" fw={500} onClick={() => setOpenRun(run.id)} ta="left">
                        {run.title}
                      </Anchor>
                    </Group>
                    {run.error && (
                      <Text size="xs" c="dimmed" lineClamp={1}>
                        {run.error}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{run.serverName}</Text>
                    {run.webAppName && (
                      <Text size="xs" c="dimmed">
                        {run.webAppName}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>{run.startedBy}</Table.Td>
                  <Table.Td>{formatDateTime(run.startedAt)}</Table.Td>
                  <Table.Td>
                    <Text size="sm" ff="monospace">
                      {run.exitCode ?? '-'}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
      {pages > 1 && (
        <Group justify="flex-end" mt="sm">
          <Pagination total={pages} value={page} onChange={setPage} size="sm" />
        </Group>
      )}
      <Modal opened={openRun !== null} onClose={() => setOpenRun(null)} title="Execução" size="xl" centered>
        {openRun !== null && <RunOutput runId={openRun} canCancel={canCancel} maxHeight={560} />}
      </Modal>
    </>
  );
}
