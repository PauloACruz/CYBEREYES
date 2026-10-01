import { Fragment, useState } from 'react';
import { ActionIcon, Badge, Group, Pagination, Paper, Stack, Table, Text } from '@mantine/core';
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { agentActionsApi } from '../../../api/agentActions';
import { queryKeys } from '../../../api/queryKeys';
import type { AgentDetail, AgentHistoryDto } from '../../../api/types';
import { OutputBlock } from '../../../components/OutputBlock';
import { EmptyRow, LoadError, LoadingRows } from '../../../components/TableStates';
import { formatDateTime, formatSeconds, totalPages } from '../../../lib/format';

const PAGE_SIZE = 25;
const COLUMNS = 5;

function HistoryOutput({ entry }: { entry: AgentHistoryDto }) {
  const result = entry.scriptResults;
  if (entry.type === 'script_run' && result) {
    return (
      <Stack gap="sm">
        <Group gap="lg">
          <Text size="sm">
            Código de retorno:{' '}
            <Badge color={result.retcode === 0 ? 'teal' : 'red'} variant="light">
              {result.retcode}
            </Badge>
          </Text>
          <Text size="sm">Tempo de execução: {formatSeconds(result.executionTime)}</Text>
        </Group>
        <OutputBlock label="Saída padrão (stdout)" value={result.stdout} maxHeight={320} />
        {result.stderr && <OutputBlock label="Saída de erro (stderr)" value={result.stderr} maxHeight={240} color="red" />}
      </Stack>
    );
  }
  return <OutputBlock label="Saída" value={entry.results ?? ''} emptyText="Sem saída registrada." maxHeight={320} />;
}

export function HistoryTab({ agent }: { agent: AgentDetail }) {
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<number | null>(null);
  const history = useQuery({
    queryKey: [...queryKeys.agentHistory(agent.id), page],
    queryFn: () => agentActionsApi.history(agent.id, page, PAGE_SIZE),
    placeholderData: keepPreviousData,
  });
  const rows = history.data?.items ?? [];

  return (
    <>
      {history.isError && <LoadError error={history.error} onRetry={() => void history.refetch()} />}
      <Paper withBorder>
        <Table.ScrollContainer minWidth={760}>
          <Table verticalSpacing="xs" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={40} aria-label="Expandir" />
                <Table.Th w={150}>Data e hora</Table.Th>
                <Table.Th w={110}>Tipo</Table.Th>
                <Table.Th>Comando ou script</Table.Th>
                <Table.Th w={160}>Usuário</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {history.isPending && <LoadingRows columns={COLUMNS} />}
              {history.isSuccess && rows.length === 0 && <EmptyRow columns={COLUMNS} message="Nenhum comando ou script executado neste agente." />}
              {rows.map((entry) => {
                const open = expanded === entry.id;
                const isScript = entry.type === 'script_run';
                return (
                  <Fragment key={entry.id}>
                    <Table.Tr style={{ cursor: 'pointer' }} onClick={() => setExpanded(open ? null : entry.id)}>
                      <Table.Td>
                        <ActionIcon variant="subtle" color="gray" size="sm" aria-label={open ? 'Recolher saída' : 'Expandir saída'} aria-expanded={open}>
                          {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                        </ActionIcon>
                      </Table.Td>
                      <Table.Td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(entry.time, '')}</Table.Td>
                      <Table.Td>
                        <Badge variant="light" size="sm" color={isScript ? 'grape' : 'blue'}>
                          {isScript ? 'Script' : 'Comando'}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" ff={isScript ? undefined : 'monospace'} lineClamp={2} style={{ wordBreak: 'break-all' }}>
                          {isScript ? (entry.scriptName ?? `Script #${entry.scriptId ?? ''}`) : (entry.command ?? '')}
                        </Text>
                      </Table.Td>
                      <Table.Td>{entry.username ?? 'Sistema'}</Table.Td>
                    </Table.Tr>
                    {open && (
                      <Table.Tr>
                        <Table.Td colSpan={COLUMNS}>
                          <HistoryOutput entry={entry} />
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
      {history.data && (
        <Group justify="space-between" mt="md">
          <Text size="sm" c="dimmed">
            {history.data.total} {history.data.total === 1 ? 'registro' : 'registros'}
          </Text>
          <Pagination total={totalPages(history.data.total, PAGE_SIZE)} value={page} onChange={setPage} size="sm" />
        </Group>
      )}
    </>
  );
}
