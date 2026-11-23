import { useState } from 'react';
import { ActionIcon, Button, Checkbox, Group, Modal, Paper, Select, Stack, Table, Text, Textarea, TextInput, Tooltip } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { projectsApi, type ProjectDetail, type ProjectTask, type SaveProjectTaskRequest } from '../../api/projects';
import { queryKeys } from '../../api/queryKeys';
import { EmptyRow } from '../../components/TableStates';
import { confirmAction, notifySuccess } from '../../lib/feedback';
import { formatDateTime } from '../../lib/format';
import { applyServerErrors } from '../../lib/forms';
import { ItemStatusBadge } from './ProjectBadges';
import { formatDay, isFinished } from './projectFormat';
import { refreshProject } from './projectActions';
import type { ProgressTarget } from './ProgressModal';

interface TaskValues {
  title: string;
  description: string;
  assigneeId: string | null;
  dueDate: string | null;
}

function toBody(v: TaskValues): SaveProjectTaskRequest {
  return { title: v.title.trim(), description: v.description.trim() || null, assigneeId: v.assigneeId, dueDate: v.dueDate };
}

function useAssignees() {
  const options = useQuery({ queryKey: queryKeys.projectOptions, queryFn: projectsApi.options, staleTime: 60_000 });
  return (options.data?.users ?? []).map((u) => ({ value: u.id, label: u.name }));
}

function TaskForm({ project, task, onDone }: { project: ProjectDetail; task: ProjectTask | null; onDone: () => void }) {
  const queryClient = useQueryClient();
  const users = useAssignees();
  const form = useForm<TaskValues>({
    initialValues: {
      title: task?.title ?? '',
      description: task?.description ?? '',
      assigneeId: task?.assignee?.id ?? null,
      dueDate: task?.dueDate ?? null,
    },
    validate: { title: (v) => (v.trim().length === 0 ? 'Informe a tarefa' : null) },
  });
  const save = useMutation({
    mutationFn: (v: TaskValues) => (task ? projectsApi.updateTask(project.id, task.id, toBody(v)) : projectsApi.addTask(project.id, toBody(v))),
    onSuccess: () => {
      refreshProject(queryClient, project.id);
      if (task) notifySuccess('Tarefa atualizada.');
      form.reset();
      onDone();
    },
    onError: (error) => applyServerErrors(form, error),
  });
  return (
    <form onSubmit={form.onSubmit((v) => save.mutate(v))} noValidate>
      <Stack gap="xs">
        <Group gap="xs" align="flex-start" wrap="wrap">
          <TextInput placeholder="Nova tarefa" aria-label="Tarefa" style={{ flex: 2, minWidth: 220 }} {...form.getInputProps('title')} />
          <Select
            placeholder="Responsável"
            aria-label="Responsável"
            clearable
            searchable
            data={users}
            style={{ flex: 1, minWidth: 180 }}
            {...form.getInputProps('assigneeId')}
          />
          <DateInput placeholder="Prazo" aria-label="Prazo" valueFormat="DD/MM/YYYY" clearable w={140} {...form.getInputProps('dueDate')} />
          {!task && (
            <Button type="submit" leftSection={<IconPlus size={16} />} loading={save.isPending}>
              Adicionar
            </Button>
          )}
        </Group>
        {task && (
          <>
            <Textarea label="Detalhes" autosize minRows={2} maxRows={6} {...form.getInputProps('description')} />
            <Group justify="flex-end">
              <Button variant="default" onClick={onDone}>
                Cancelar
              </Button>
              <Button type="submit" loading={save.isPending}>
                Salvar
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </form>
  );
}

export function ProjectTasks({ project, onRecord }: { project: ProjectDetail; onRecord: (target: ProgressTarget) => void }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<ProjectTask | null>(null);
  const manage = project.can.manage;
  const open = project.status === 'active' || project.status === 'paused';

  const toggle = useMutation({
    mutationFn: ({ task, done }: { task: ProjectTask; done: boolean }) =>
      projectsApi.progress(project.id, { taskIds: [task.id], status: done ? 'done' : 'pending' }),
    onSuccess: () => refreshProject(queryClient, project.id),
  });
  const remove = useMutation({
    mutationFn: (task: ProjectTask) => projectsApi.removeTask(project.id, task.id),
    onSuccess: () => {
      refreshProject(queryClient, project.id);
      notifySuccess('Tarefa excluída.');
    },
  });

  return (
    <Stack gap="sm">
      {manage && open && (
        <Paper withBorder p="sm">
          <TaskForm project={project} task={null} onDone={() => undefined} />
        </Paper>
      )}
      <Paper withBorder>
        <Table.ScrollContainer minWidth={720}>
          <Table verticalSpacing="xs" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={36} />
                <Table.Th>Tarefa</Table.Th>
                <Table.Th>Responsável</Table.Th>
                <Table.Th>Prazo</Table.Th>
                <Table.Th>Situação</Table.Th>
                <Table.Th w={140} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {project.tasks.length === 0 && <EmptyRow columns={6} message="Nenhuma tarefa neste projeto." />}
              {project.tasks.map((t) => (
                <Table.Tr key={t.id}>
                  <Table.Td>
                    <Checkbox
                      aria-label={`Concluir ${t.title}`}
                      checked={t.status === 'done'}
                      disabled={!t.canUpdate || toggle.isPending}
                      onChange={(e) => toggle.mutate({ task: t, done: e.currentTarget.checked })}
                    />
                  </Table.Td>
                  <Table.Td maw={360}>
                    <Text size="sm" fw={500} td={isFinished(t.status) ? 'line-through' : undefined}>
                      {t.title}
                    </Text>
                    {t.description && (
                      <Text size="xs" c="dimmed" lineClamp={2} style={{ whiteSpace: 'pre-wrap' }}>
                        {t.description}
                      </Text>
                    )}
                    {t.note && (
                      <Text size="xs" c="dimmed" lineClamp={2} fs="italic" title={t.note}>
                        “{t.note}”
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{t.assignee?.name ?? '—'}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c={t.overdue ? 'red' : undefined} fw={t.overdue ? 600 : undefined}>
                      {formatDay(t.dueDate)}
                      {t.overdue && ' (atrasada)'}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <ItemStatusBadge status={t.status} />
                    {t.doneAt && (
                      <Text size="xs" c="dimmed">
                        {t.doneByName}, {formatDateTime(t.doneAt)}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} justify="flex-end" wrap="nowrap">
                      {t.canUpdate && (
                        <Button size="compact-xs" variant="light" onClick={() => onRecord({ kind: 'task', task: t })}>
                          Registrar
                        </Button>
                      )}
                      {manage && open && (
                        <>
                          <Tooltip label="Editar">
                            <ActionIcon variant="subtle" aria-label={`Editar ${t.title}`} onClick={() => setEditing(t)}>
                              <IconPencil size={16} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label="Excluir">
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              aria-label={`Excluir ${t.title}`}
                              onClick={() =>
                                confirmAction({
                                  title: 'Excluir tarefa',
                                  message: `Excluir "${t.title}"? Os registros da documentação continuam.`,
                                  confirmLabel: 'Excluir',
                                  danger: true,
                                  onConfirm: () => remove.mutate(t),
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
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
      <Modal opened={editing !== null} onClose={() => setEditing(null)} title="Editar tarefa" size="lg">
        {editing && <TaskForm project={project} task={editing} onDone={() => setEditing(null)} />}
      </Modal>
    </Stack>
  );
}
