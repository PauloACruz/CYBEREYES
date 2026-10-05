import { useState } from 'react';
import { Badge, Group, Pagination, Paper, Table, Text, Title } from '@mantine/core';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import type { CareCatalog } from '../../api/types';
import { careApi } from '../../api/care';
import { EmptyRow, LoadError, LoadingRows } from '../../components/TableStates';
import { formatDateTime, totalPages } from '../../lib/format';
import { CARE_NAME, moduleLabel, RUN_STATUS_COLOR, RUN_STATUS_LABEL } from './careFormat';

const PAGE_SIZE = 10;
const COLUMNS = 5;

interface RunHistoryProps {
  agentId: number;
  catalog: CareCatalog | undefined;
  selectedRunId: string | null;
  onSelect: (runId: string) => void;
}

export function RunHistory({ agentId, catalog, selectedRunId, onSelect }: RunHistoryProps) {
  const [page, setPage] = useState(1);
  const runs = useQuery({
    queryKey: queryKeys.careRuns(agentId, page),
    queryFn: () => careApi.runs(agentId, page, PAGE_SIZE),
    placeholderData: keepPreviousData,
  });
  const rows = runs.data?.items ?? [];

  return (
    <section aria-labelledby="care-history-title">
      <Title order={5} id="care-history-title" mb="xs">
        Histórico de execuções
      </Title>
      {runs.isError && <LoadError error={runs.error} onRetry={() => void runs.refetch()} />}
      <Paper withBorder>
        <Table.ScrollContainer minWidth={620}>
          <Table verticalSpacing="xs" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={150}>Início</Table.Th>
                <Table.Th>Módulo</Table.Th>
                <Table.Th w={90}>Tarefas</Table.Th>
                <Table.Th w={170}>Situação</Table.Th>
                <Table.Th w={160}>Solicitado por</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {runs.isPending && <LoadingRows columns={COLUMNS} rows={3} />}
              {runs.isSuccess && rows.length === 0 && <EmptyRow columns={COLUMNS} message={`Nenhuma execução do ${CARE_NAME} nesta máquina.`} />}
              {rows.map((run) => (
                <Table.Tr
                  key={run.runId}
                  style={{ cursor: 'pointer' }}
                  bg={run.runId === selectedRunId ? 'var(--mantine-color-blue-light)' : undefined}
                  aria-selected={run.runId === selectedRunId}
                  tabIndex={0}
                  onClick={() => onSelect(run.runId)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(run.runId);
                    }
                  }}
                >
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(run.startedAt)}</Table.Td>
                  <Table.Td>{moduleLabel(catalog, run.module)}</Table.Td>
                  <Table.Td>{run.tasks.length}</Table.Td>
                  <Table.Td>
                    <Badge color={RUN_STATUS_COLOR[run.status]} variant="light" size="sm">
                      {RUN_STATUS_LABEL[run.status]}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">
                      {run.requestedBy}
                      {run.source === 'tray' ? ' (app)' : ''}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
      {runs.data && runs.data.total > PAGE_SIZE && (
        <Group justify="flex-end" mt="sm">
          <Pagination value={page} onChange={setPage} total={totalPages(runs.data.total, PAGE_SIZE)} size="sm" />
        </Group>
      )}
    </section>
  );
}
