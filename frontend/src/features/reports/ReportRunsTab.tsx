import { useState } from 'react';
import { ActionIcon, Badge, Group, Pagination, Paper, Table, Text, Tooltip } from '@mantine/core';
import { IconDownload, IconTrash } from '@tabler/icons-react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { reportDownloadUrl, reportsApi } from '../../api/reports';
import { queryKeys } from '../../api/queryKeys';
import type { ReportRunDto } from '../../api/types';
import { EmptyRow, LoadError, LoadingRows } from '../../components/TableStates';
import { confirmAction, notifySuccess } from '../../lib/feedback';
import { formatBytes, formatDateTime, totalPages } from '../../lib/format';
import { FORMAT_LABEL } from './reportFormat';

const PAGE_SIZE = 25;
const COLUMNS = 7;

export function RunStatusBadge({ run }: { run: Pick<ReportRunDto, 'status' | 'error'> }) {
  if (run.status === 'error') {
    return (
      <Tooltip label={run.error ?? 'Falha na geração'} multiline maw={320} withArrow>
        <Badge color="red" variant="light" tabIndex={0}>
          Erro
        </Badge>
      </Tooltip>
    );
  }
  if (run.error) {
    return (
      <Tooltip label={run.error} multiline maw={320} withArrow>
        <Badge color="yellow" variant="light" tabIndex={0}>
          Gerado, falha no envio
        </Badge>
      </Tooltip>
    );
  }
  return (
    <Badge color="teal" variant="light">
      Gerado
    </Badge>
  );
}

export function ReportRunsTab({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const params = { page, pageSize: PAGE_SIZE };
  const runs = useQuery({
    queryKey: queryKeys.reportRunList(params),
    queryFn: () => reportsApi.runs(params),
    placeholderData: keepPreviousData,
  });

  const remove = useMutation({
    mutationFn: (run: ReportRunDto) => reportsApi.removeRun(run.id),
    onSuccess: async (_, run) => {
      notifySuccess(`Arquivo ${run.fileName} excluído.`);
      await queryClient.invalidateQueries({ queryKey: queryKeys.reportRuns });
    },
  });

  const items = runs.data?.items ?? [];

  return (
    <>
      {runs.isError && <LoadError error={runs.error} onRetry={() => void runs.refetch()} />}
      <Paper withBorder>
        <Table.ScrollContainer minWidth={900}>
          <Table striped highlightOnHover verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Relatório</Table.Th>
                <Table.Th>Formato</Table.Th>
                <Table.Th>Situação</Table.Th>
                <Table.Th>Tamanho</Table.Th>
                <Table.Th>Gerado em</Table.Th>
                <Table.Th>Solicitado por</Table.Th>
                <Table.Th w={100}>
                  <span className="mantine-visually-hidden">Ações</span>
                </Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {runs.isPending && <LoadingRows columns={COLUMNS} />}
              {runs.isSuccess && items.length === 0 && <EmptyRow columns={COLUMNS} message="Nenhum relatório gerado." />}
              {items.map((run) => (
                <Table.Tr key={run.id}>
                  <Table.Td>
                    <Text size="sm" fw={500}>
                      {run.title}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {run.fileName}
                      {run.scheduleId ? ' (agendado)' : ''}
                    </Text>
                    {run.emailedTo.length > 0 && (
                      <Text size="xs" c="dimmed">
                        Enviado para {run.emailedTo.join(', ')}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="outline" color="gray">
                      {FORMAT_LABEL[run.format]}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <RunStatusBadge run={run} />
                  </Table.Td>
                  <Table.Td>{run.status === 'ok' ? formatBytes(run.size) : ''}</Table.Td>
                  <Table.Td>{formatDateTime(run.createdAt)}</Table.Td>
                  <Table.Td>{run.requestedBy}</Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap="nowrap" justify="flex-end">
                      {run.status === 'ok' && (
                        <Tooltip label="Baixar">
                          <ActionIcon
                            component="a"
                            href={reportDownloadUrl(run.id)}
                            download={run.fileName}
                            variant="subtle"
                            color="gray"
                            aria-label={`Baixar ${run.fileName}`}
                          >
                            <IconDownload size={16} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                      {canManage && (
                        <Tooltip label="Excluir">
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            aria-label={`Excluir ${run.fileName || run.title}`}
                            onClick={() =>
                              confirmAction({
                                title: 'Excluir relatório gerado',
                                message: `Excluir o arquivo ${run.fileName || run.title}? Esta ação não pode ser desfeita.`,
                                confirmLabel: 'Excluir',
                                danger: true,
                                onConfirm: () => remove.mutate(run),
                              })
                            }
                          >
                            <IconTrash size={16} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
      {runs.data && runs.data.total > 0 && (
        <Group justify="space-between" mt="md">
          <Text size="sm" c="dimmed">
            {runs.data.total} {runs.data.total === 1 ? 'arquivo' : 'arquivos'}. Os arquivos ficam guardados por 90 dias.
          </Text>
          <Pagination
            total={totalPages(runs.data.total, PAGE_SIZE)}
            value={page}
            onChange={setPage}
            size="sm"
            getControlProps={(control) => ({
              'aria-label': control === 'previous' ? 'Página anterior' : control === 'next' ? 'Próxima página' : undefined,
            })}
          />
        </Group>
      )}
    </>
  );
}
