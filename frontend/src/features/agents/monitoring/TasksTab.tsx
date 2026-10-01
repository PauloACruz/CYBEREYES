import { Fragment, useMemo, useState } from 'react';
import { ActionIcon, Anchor, Badge, Button, Group, Paper, Stack, Table, Text, Tooltip } from '@mantine/core';
import {
  IconChevronDown,
  IconChevronRight,
  IconExternalLink,
  IconPencil,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { checksApi, tasksApi } from '../../../api/monitoring';
import { queryKeys } from '../../../api/queryKeys';
import { PERMISSIONS, type AgentDetail, type AgentTaskDto, type TaskDto } from '../../../api/types';
import { policyPath } from '../../../app/paths';
import { hasPermission } from '../../../auth/permissions';
import { useMe } from '../../../auth/useMe';
import { OutputBlock } from '../../../components/OutputBlock';
import { EmptyRow, LoadError, LoadingRows } from '../../../components/TableStates';
import { confirmAction, notifySuccess } from '../../../lib/feedback';
import { formatDateTime, formatSeconds } from '../../../lib/format';
import { RelativeTime } from '../agentDisplay';
import { checkDisplayName } from '../../monitoring/checks/checkForm';
import { CheckStatusBadge, InheritedBadge } from '../../monitoring/MonitoringBadges';
import { isCheckStatus } from '../../monitoring/monitoringFormat';
import { describeSchedule } from '../../monitoring/tasks/schedule';
import { TaskFormModal } from '../../monitoring/tasks/TaskFormModal';

const COLUMNS = 6;

export function TaskResultBadge({ status }: { status: string }) {
  if (isCheckStatus(status)) return <CheckStatusBadge status={status} severity={null} />;
  return (
    <Badge variant="light" color="gray">
      {status}
    </Badge>
  );
}

export function TasksTab({ agent }: { agent: AgentDetail }) {
  const { data: me } = useMe();
  const canManage = hasPermission(me, PERMISSIONS.checksManage);
  const canRun = hasPermission(me, PERMISSIONS.agentsRun);
  const queryClient = useQueryClient();
  const tasks = useQuery({ queryKey: queryKeys.agentTasks(agent.id), queryFn: () => tasksApi.forAgent(agent.id) });
  const checks = useQuery({ queryKey: queryKeys.agentChecks(agent.id), queryFn: () => checksApi.forAgent(agent.id) });
  const checkNames = useMemo(() => new Map((checks.data ?? []).map((c) => [c.check.id, checkDisplayName(c.check)])), [checks.data]);
  const checkOptions = useMemo(
    () => (checks.data ?? []).map((c) => ({ value: String(c.check.id), label: checkDisplayName(c.check) })),
    [checks.data],
  );
  const [expanded, setExpanded] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ task: TaskDto | null } | null>(null);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: queryKeys.agentTasks(agent.id) });

  const run = useMutation({
    mutationFn: (task: TaskDto) => tasksApi.run(agent.id, task.id),
    onSuccess: (_, task) => {
      notifySuccess(`A tarefa ${task.name} foi enviada ao agente.`, 'Tarefa iniciada');
      setTimeout(refresh, 5000);
    },
  });
  const remove = useMutation({
    mutationFn: (task: TaskDto) => tasksApi.remove(task.id),
    onSuccess: () => {
      notifySuccess('Tarefa excluída.');
      refresh();
    },
  });

  const rows: AgentTaskDto[] = tasks.data ?? [];

  return (
    <Stack>
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          Os horários seguem o fuso das configurações gerais.
        </Text>
        {canManage && (
          <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing({ task: null })}>
            Nova tarefa
          </Button>
        )}
      </Group>
      {tasks.isError && <LoadError error={tasks.error} onRetry={() => void tasks.refetch()} />}
      <Paper withBorder>
        <Table.ScrollContainer minWidth={900}>
          <Table verticalSpacing="xs" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={40} aria-label="Expandir" />
                <Table.Th>Tarefa</Table.Th>
                <Table.Th>Agendamento</Table.Th>
                <Table.Th w={140}>Próxima execução</Table.Th>
                <Table.Th w={200}>Último resultado</Table.Th>
                <Table.Th w={120} aria-label="Ações" />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {tasks.isPending && <LoadingRows columns={COLUMNS} />}
              {tasks.isSuccess && rows.length === 0 && <EmptyRow columns={COLUMNS} message="Nenhuma tarefa configurada neste agente." />}
              {rows.map((item) => {
                const { task, result } = item;
                const open = expanded === task.id;
                const checkName = task.assignedCheckId !== null ? checkNames.get(task.assignedCheckId) : undefined;
                return (
                  <Fragment key={task.id}>
                    <Table.Tr>
                      <Table.Td>
                        <ActionIcon
                          variant="subtle"
                          color="gray"
                          size="sm"
                          aria-label={open ? `Recolher saída de ${task.name}` : `Ver saída de ${task.name}`}
                          aria-expanded={open}
                          onClick={() => setExpanded(open ? null : task.id)}
                        >
                          {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                        </ActionIcon>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={6} wrap="nowrap">
                          <Text size="sm" fw={500}>
                            {task.name}
                          </Text>
                          {item.inherited && <InheritedBadge policyName={item.policyName} />}
                          {!task.enabled && (
                            <Badge variant="light" color="gray" size="sm" leftSection={<IconPlayerPause size={10} aria-hidden />}>
                              Desativada
                            </Badge>
                          )}
                        </Group>
                        <Text size="xs" c="dimmed">
                          {task.actions.length} {task.actions.length === 1 ? 'ação' : 'ações'}
                          {item.inherited && item.policyName ? ` · Política ${item.policyName}` : ''}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{describeSchedule(task, checkName)}</Text>
                      </Table.Td>
                      <Table.Td>{item.nextRun ? formatDateTime(item.nextRun) : 'Sem agendamento'}</Table.Td>
                      <Table.Td>
                        {result ? (
                          <Group gap={6} wrap="nowrap">
                            <TaskResultBadge status={result.status} />
                            {result.retcode !== null && (
                              <Text size="xs" c="dimmed">
                                código {result.retcode}
                              </Text>
                            )}
                          </Group>
                        ) : (
                          <Text size="sm" c="dimmed">
                            Nunca executada
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4} wrap="nowrap" justify="flex-end">
                          {canRun && (
                            <Tooltip label="Executar agora">
                              <ActionIcon
                                variant="subtle"
                                color="teal"
                                aria-label={`Executar tarefa ${task.name} agora`}
                                loading={run.isPending && run.variables.id === task.id}
                                onClick={() =>
                                  confirmAction({
                                    title: 'Executar tarefa',
                                    message: `Executar a tarefa ${task.name} em ${agent.hostname} agora?`,
                                    confirmLabel: 'Executar',
                                    onConfirm: () => run.mutate(task),
                                  })
                                }
                              >
                                <IconPlayerPlay size={16} />
                              </ActionIcon>
                            </Tooltip>
                          )}
                          {item.inherited && task.policyId !== null && (
                            <Tooltip label="Editar na política">
                              <Anchor component={Link} to={policyPath(task.policyId)} aria-label={`Abrir a política da tarefa ${task.name}`}>
                                <IconExternalLink size={16} />
                              </Anchor>
                            </Tooltip>
                          )}
                          {!item.inherited && canManage && (
                            <>
                              <Tooltip label="Editar">
                                <ActionIcon variant="subtle" color="gray" aria-label={`Editar tarefa ${task.name}`} onClick={() => setEditing({ task })}>
                                  <IconPencil size={16} />
                                </ActionIcon>
                              </Tooltip>
                              <Tooltip label="Excluir">
                                <ActionIcon
                                  variant="subtle"
                                  color="red"
                                  aria-label={`Excluir tarefa ${task.name}`}
                                  onClick={() =>
                                    confirmAction({
                                      title: 'Excluir tarefa',
                                      message: `Excluir a tarefa ${task.name}?`,
                                      confirmLabel: 'Excluir',
                                      danger: true,
                                      onConfirm: () => remove.mutate(task),
                                    })
                                  }
                                >
                                  <IconTrash size={16} />
                                </ActionIcon>
                              </Tooltip>
                            </>
                          )}
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                    {open && (
                      <Table.Tr>
                        <Table.Td colSpan={COLUMNS}>
                          {result ? (
                            <Stack gap="sm" py="xs">
                              <Group gap="lg">
                                <Text size="sm">Executada em {formatDateTime(result.lastRun)}</Text>
                                {result.lastRun && (
                                  <Text size="sm" c="dimmed">
                                    (<RelativeTime value={result.lastRun} />)
                                  </Text>
                                )}
                                {result.executionTime !== null && <Text size="sm">Tempo de execução: {formatSeconds(result.executionTime)}</Text>}
                              </Group>
                              <OutputBlock label="Saída padrão (stdout)" value={result.stdout ?? ''} maxHeight={280} />
                              {result.stderr && <OutputBlock label="Saída de erro (stderr)" value={result.stderr} maxHeight={200} color="red" />}
                            </Stack>
                          ) : (
                            <Text size="sm" c="dimmed" py="xs">
                              Esta tarefa ainda não foi executada neste agente.
                            </Text>
                          )}
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
      {canManage && (
        <TaskFormModal
          opened={editing !== null}
          onClose={() => setEditing(null)}
          current={editing?.task ?? null}
          owner={{ agentId: agent.id, policyId: null }}
          plat={agent.plat}
          checkOptions={checkOptions}
          onSaved={refresh}
        />
      )}
    </Stack>
  );
}
