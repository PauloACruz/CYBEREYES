import { useState } from 'react';
import { ActionIcon, Badge, Button, Group, Paper, Stack, Table, Text, Tooltip } from '@mantine/core';
import { IconPencil, IconPlayerPlay, IconPlus, IconTrash } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { reportsApi } from '../../api/reports';
import { queryKeys } from '../../api/queryKeys';
import type { ReportScheduleDto, ReportTypeDto } from '../../api/types';
import { EmptyRow, LoadError, LoadingRows } from '../../components/TableStates';
import { confirmAction, notifySuccess } from '../../lib/feedback';
import { formatDateTime } from '../../lib/format';
import { describeSchedule, FORMAT_LABEL, REPORT_PERIOD_LABEL } from './reportFormat';
import { ScheduleFormModal } from './ScheduleFormModal';

const COLUMNS = 7;

interface ReportSchedulesTabProps {
  types: ReportTypeDto[];
  canManage: boolean;
}

export function ReportSchedulesTab({ types, canManage }: ReportSchedulesTabProps) {
  const queryClient = useQueryClient();
  const schedules = useQuery({ queryKey: queryKeys.reportSchedules, queryFn: reportsApi.schedules });
  const [editing, setEditing] = useState<{ schedule: ReportScheduleDto | null } | null>(null);
  const typeLabel = (type: string) => types.find((t) => t.type === type)?.label ?? type;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['reports'] });

  const remove = useMutation({
    mutationFn: (schedule: ReportScheduleDto) => reportsApi.removeSchedule(schedule.id),
    onSuccess: async (_, schedule) => {
      notifySuccess(`Agendamento ${schedule.name} excluído.`);
      await invalidate();
    },
  });
  const runNow = useMutation({
    mutationFn: (schedule: ReportScheduleDto) => reportsApi.runSchedule(schedule.id),
    onSuccess: async (run, schedule) => {
      const title = `Agendamento ${schedule.name}`;
      if (run.status === 'error') notifications.show({ color: 'red', title, message: run.error ?? 'Falha ao gerar o relatório.' });
      else if (run.error) notifications.show({ color: 'yellow', title, message: `Arquivo gerado, mas o envio falhou: ${run.error}` });
      else notifySuccess(`Relatório gerado e enviado para ${run.emailedTo.length || schedule.recipients.length} destinatário(s).`, title);
      await invalidate();
    },
  });

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="flex-end">
        <Text size="sm" c="dimmed">
          Os relatórios agendados são gerados no fuso das configurações gerais e enviados por e-mail com o arquivo anexo.
        </Text>
        {canManage && (
          <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing({ schedule: null })} disabled={types.length === 0}>
            Novo agendamento
          </Button>
        )}
      </Group>
      {schedules.isError && <LoadError error={schedules.error} onRetry={() => void schedules.refetch()} />}
      <Paper withBorder>
        <Table.ScrollContainer minWidth={960}>
          <Table striped verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Nome</Table.Th>
                <Table.Th>Relatório</Table.Th>
                <Table.Th>Frequência</Table.Th>
                <Table.Th>Próxima execução</Table.Th>
                <Table.Th>Última execução</Table.Th>
                <Table.Th>Situação</Table.Th>
                <Table.Th w={130}>
                  <span className="mantine-visually-hidden">Ações</span>
                </Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {schedules.isPending && <LoadingRows columns={COLUMNS} rows={3} />}
              {schedules.isSuccess && schedules.data.length === 0 && <EmptyRow columns={COLUMNS} message="Nenhum agendamento." />}
              {schedules.data?.map((schedule) => (
                <Table.Tr key={schedule.id}>
                  <Table.Td>
                    <Text size="sm" fw={500}>
                      {schedule.name}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {schedule.recipients.length} {schedule.recipients.length === 1 ? 'destinatário' : 'destinatários'}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">
                      {typeLabel(schedule.params.type)} ({FORMAT_LABEL[schedule.format]})
                    </Text>
                    {schedule.params.period && (
                      <Text size="xs" c="dimmed">
                        {REPORT_PERIOD_LABEL[schedule.params.period]}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>{describeSchedule(schedule)}</Table.Td>
                  <Table.Td>{schedule.enabled ? formatDateTime(schedule.nextRunAt, 'Não agendada') : 'Pausado'}</Table.Td>
                  <Table.Td>
                    <Group gap={6} wrap="nowrap">
                      <Text size="sm">{formatDateTime(schedule.lastRunAt)}</Text>
                      {schedule.lastStatus === 'ok' && (
                        <Badge color="teal" variant="light" size="sm">
                          OK
                        </Badge>
                      )}
                      {schedule.lastStatus === 'error' && (
                        <Badge color="red" variant="light" size="sm">
                          Erro
                        </Badge>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Badge color={schedule.enabled ? 'teal' : 'gray'} variant="light">
                      {schedule.enabled ? 'Ativo' : 'Inativo'}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    {canManage && (
                      <Group gap={4} wrap="nowrap" justify="flex-end">
                        <Tooltip label="Executar agora">
                          <ActionIcon
                            variant="subtle"
                            color="gray"
                            aria-label={`Executar agora ${schedule.name}`}
                            loading={runNow.isPending && runNow.variables.id === schedule.id}
                            onClick={() =>
                              confirmAction({
                                title: 'Executar agora',
                                message: `Gerar o relatório ${schedule.name} e enviar para ${schedule.recipients.join(', ')}?`,
                                confirmLabel: 'Executar',
                                onConfirm: () => runNow.mutate(schedule),
                              })
                            }
                          >
                            <IconPlayerPlay size={16} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Editar">
                          <ActionIcon variant="subtle" color="gray" aria-label={`Editar ${schedule.name}`} onClick={() => setEditing({ schedule })}>
                            <IconPencil size={16} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Excluir">
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            aria-label={`Excluir ${schedule.name}`}
                            onClick={() =>
                              confirmAction({
                                title: 'Excluir agendamento',
                                message: `Excluir o agendamento ${schedule.name}?`,
                                confirmLabel: 'Excluir',
                                danger: true,
                                onConfirm: () => remove.mutate(schedule),
                              })
                            }
                          >
                            <IconTrash size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
      <ScheduleFormModal opened={editing !== null} schedule={editing?.schedule ?? null} types={types} onClose={() => setEditing(null)} />
    </Stack>
  );
}
