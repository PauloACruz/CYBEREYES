import { useState } from 'react';
import { ActionIcon, Alert, Button, Divider, Group, Modal, MultiSelect, NumberInput, Select, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { IconInfoCircle, IconPlus, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { projectsApi, type ProjectDetail, type ProjectRecurrence, type SaveProjectRequest } from '../../api/projects';
import { queryKeys } from '../../api/queryKeys';
import { notifySuccess } from '../../lib/feedback';
import { applyServerErrors } from '../../lib/forms';
import { RECURRENCE_OPTIONS, recurrenceUnit } from './projectFormat';
import { StationPicker } from './StationPicker';

interface Props {
  opened: boolean;
  /** Projeto a editar; nulo cria um novo. */
  project: ProjectDetail | null;
  onClose: () => void;
  onSaved: (project: ProjectDetail) => void;
}

interface TaskDraft {
  key: number;
  title: string;
  assigneeId: string | null;
  dueDate: string | null;
}

interface FormValues {
  name: string;
  description: string;
  ownerId: string | null;
  recurrence: ProjectRecurrence;
  recurrenceInterval: number | string;
  startDate: string | null;
  dueDate: string | null;
  clientIds: string[];
  siteIds: string[];
  agentIds: number[];
  tasks: TaskDraft[];
}

function initialValues(project: ProjectDetail | null): FormValues {
  return {
    name: project?.name ?? '',
    description: project?.description ?? '',
    ownerId: project?.owner?.id ?? null,
    recurrence: project?.recurrence ?? 'none',
    recurrenceInterval: project?.recurrenceInterval ?? 1,
    startDate: project?.startDate ?? null,
    dueDate: project?.dueDate ?? null,
    clientIds: (project?.clients ?? []).map((c) => String(c.id)),
    siteIds: (project?.sites ?? []).map((s) => String(s.id)),
    agentIds: (project?.agents ?? []).map((a) => a.agentId).filter((id): id is number => id !== null),
    tasks: [],
  };
}

function ProjectForm({ project, onClose, onSaved }: Omit<Props, 'opened'>) {
  const queryClient = useQueryClient();
  const options = useQuery({ queryKey: queryKeys.projectOptions, queryFn: projectsApi.options, staleTime: 60_000 });
  const [nextKey, setNextKey] = useState(1);
  const form = useForm<FormValues>({
    initialValues: initialValues(project),
    validate: {
      name: (v) => (v.trim().length < 2 ? 'Use pelo menos 2 caracteres' : null),
      startDate: (v, values) => (values.recurrence !== 'none' && !v ? 'O projeto recorrente precisa da data do primeiro ciclo' : null),
      dueDate: (v, values) => (v && values.startDate && v < values.startDate ? 'O prazo não pode ser antes do início' : null),
      tasks: {
        title: (v) => (v.trim().length === 0 ? 'Informe a tarefa' : null),
      },
    },
  });

  const users = (options.data?.users ?? []).map((u) => ({ value: u.id, label: u.name }));
  const clients = options.data?.clients ?? [];
  const selectedClients = form.values.clientIds.map(Number);
  const siteGroups = clients
    .filter((c) => selectedClients.length === 0 || selectedClients.includes(c.id))
    .map((c) => ({ group: c.name, items: c.sites.map((s) => ({ value: String(s.id), label: `${s.name} (${c.name})` })) }))
    .filter((g) => g.items.length > 0);

  const save = useMutation({
    mutationFn: (v: FormValues) => {
      const body: SaveProjectRequest = {
        name: v.name.trim(),
        description: v.description.trim() || null,
        ownerId: v.ownerId,
        recurrence: v.recurrence,
        recurrenceInterval: v.recurrence === 'none' ? 1 : Number(v.recurrenceInterval) || 1,
        startDate: v.startDate,
        dueDate: v.dueDate,
        clientIds: v.clientIds.map(Number),
        siteIds: v.siteIds.map(Number),
        agentIds: v.agentIds,
      };
      if (!project) body.tasks = v.tasks.map((t) => ({ title: t.title.trim(), assigneeId: t.assigneeId, dueDate: t.dueDate }));
      return project ? projectsApi.update(project.id, body) : projectsApi.create(body);
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      queryClient.setQueryData(queryKeys.project(saved.id), saved);
      notifySuccess(project ? 'Projeto atualizado.' : 'Projeto criado.');
      onSaved(saved);
    },
    onError: (error) => applyServerErrors(form, error),
  });

  const removedStations = project ? project.agents.filter((a) => a.agentId !== null && !form.values.agentIds.includes(a.agentId)).length : 0;

  return (
    <form onSubmit={form.onSubmit((v) => save.mutate(v))} noValidate>
      <Stack gap="sm">
        <TextInput label="Nome" placeholder="Ex.: Limpeza física das estações" required data-autofocus {...form.getInputProps('name')} />
        <Textarea label="Descrição" placeholder="Objetivo, escopo, cuidados e materiais" autosize minRows={2} maxRows={6} {...form.getInputProps('description')} />
        <Group grow align="flex-start">
          <Select label="Responsável pelo projeto" placeholder="Ninguém" clearable searchable data={users} {...form.getInputProps('ownerId')} />
          <Select
            label="Repetição"
            data={RECURRENCE_OPTIONS}
            allowDeselect={false}
            {...form.getInputProps('recurrence')}
          />
          {form.values.recurrence !== 'none' && (
            <NumberInput
              label="A cada"
              min={1}
              max={365}
              allowDecimal={false}
              rightSection={
                <Text size="xs" c="dimmed" pr={8}>
                  {recurrenceUnit(form.values.recurrence, Number(form.values.recurrenceInterval) || 1)}
                </Text>
              }
              rightSectionWidth={70}
              {...form.getInputProps('recurrenceInterval')}
            />
          )}
        </Group>
        <Group grow align="flex-start">
          <DateInput
            label={form.values.recurrence === 'none' ? 'Início' : 'Início do primeiro ciclo'}
            placeholder="Sem data"
            valueFormat="DD/MM/YYYY"
            clearable
            required={form.values.recurrence !== 'none'}
            {...form.getInputProps('startDate')}
          />
          <DateInput
            label={form.values.recurrence === 'none' ? 'Prazo' : 'Prazo do ciclo'}
            placeholder="Sem prazo"
            valueFormat="DD/MM/YYYY"
            clearable
            minDate={form.values.startDate ?? undefined}
            {...form.getInputProps('dueDate')}
          />
        </Group>
        {form.values.recurrence !== 'none' && (
          <Text size="xs" c="dimmed">
            Ao concluir um ciclo, o resultado vai para o histórico, as estações e tarefas voltam a pendentes e as datas (do ciclo e das tarefas)
            avançam um período.
          </Text>
        )}

        <Divider label="Escopo (opcional)" labelPosition="left" mt="xs" />
        <Text size="xs" c="dimmed">
          Deixe em branco para um projeto interno, só com tarefas. Os clientes das estações e dos setores escolhidos entram no projeto sozinhos.
        </Text>
        <Group grow align="flex-start">
          <MultiSelect
            label="Clientes"
            placeholder="Nenhum"
            searchable
            clearable
            data={clients.map((c) => ({ value: String(c.id), label: c.name }))}
            {...form.getInputProps('clientIds')}
          />
          <MultiSelect label="Setores" placeholder="Nenhum" searchable clearable data={siteGroups} {...form.getInputProps('siteIds')} />
        </Group>
        <StationPicker
          agents={options.data?.agents ?? []}
          clients={clients}
          clientIds={selectedClients}
          siteIds={form.values.siteIds.map(Number)}
          value={form.values.agentIds}
          onChange={(ids) => form.setFieldValue('agentIds', ids)}
          error={typeof form.errors.agentIds === 'string' ? form.errors.agentIds : undefined}
        />
        {removedStations > 0 && (
          <Alert color="yellow" icon={<IconInfoCircle size={16} />} p="xs">
            {removedStations === 1 ? '1 estação sai' : `${removedStations} estações saem`} do projeto e perde(m) a situação do ciclo atual; os
            registros da documentação continuam.
          </Alert>
        )}

        {!project && (
          <>
            <Divider label="Tarefas" labelPosition="left" mt="xs" />
            {form.values.tasks.length === 0 && (
              <Text size="xs" c="dimmed">
                Liste o que precisa ser feito e quem faz. Dá para incluir e alterar tarefas depois, na página do projeto.
              </Text>
            )}
            {form.values.tasks.map((task, index) => (
              <Group key={task.key} gap="xs" align="flex-start" wrap="nowrap">
                <TextInput placeholder="Tarefa" aria-label={`Tarefa ${index + 1}`} style={{ flex: 2 }} {...form.getInputProps(`tasks.${index}.title`)} />
                <Select
                  placeholder="Responsável"
                  aria-label={`Responsável pela tarefa ${index + 1}`}
                  clearable
                  searchable
                  data={users}
                  style={{ flex: 1 }}
                  {...form.getInputProps(`tasks.${index}.assigneeId`)}
                />
                <DateInput
                  placeholder="Prazo"
                  aria-label={`Prazo da tarefa ${index + 1}`}
                  valueFormat="DD/MM/YYYY"
                  clearable
                  w={140}
                  {...form.getInputProps(`tasks.${index}.dueDate`)}
                />
                <ActionIcon variant="subtle" color="red" mt={6} aria-label={`Remover tarefa ${index + 1}`} onClick={() => form.removeListItem('tasks', index)}>
                  <IconTrash size={16} />
                </ActionIcon>
              </Group>
            ))}
            {typeof form.errors.tasks === 'string' && (
              <Text size="xs" c="red">
                {form.errors.tasks}
              </Text>
            )}
            <Group>
              <Button
                variant="subtle"
                size="xs"
                leftSection={<IconPlus size={14} />}
                onClick={() => {
                  form.insertListItem('tasks', { key: nextKey, title: '', assigneeId: null, dueDate: null });
                  setNextKey((k) => k + 1);
                }}
              >
                Adicionar tarefa
              </Button>
            </Group>
          </>
        )}

        <Group justify="flex-end" mt="sm">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            {project ? 'Salvar' : 'Criar projeto'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

export function ProjectFormModal({ opened, project, onClose, onSaved }: Props) {
  return (
    <Modal opened={opened} onClose={onClose} title={project ? 'Editar projeto' : 'Novo projeto'} size="xl">
      {opened && <ProjectForm project={project} onClose={onClose} onSaved={onSaved} />}
    </Modal>
  );
}
