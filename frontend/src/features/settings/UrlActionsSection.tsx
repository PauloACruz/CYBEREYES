import { useState } from 'react';
import { ActionIcon, Button, Group, Modal, Paper, Stack, Table, Text, TextInput, Title, Tooltip } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import { urlActionsApi } from '../../api/settings';
import type { SaveUrlActionRequest, UrlActionDto } from '../../api/types';
import { EmptyRow, LoadError, LoadingRows } from '../../components/TableStates';
import { confirmAction, notifySuccess } from '../../lib/feedback';
import { applyServerErrors } from '../../lib/forms';
import { TemplateVariablesHint } from '../scripts/TemplateVariablesHint';

const COLUMNS = 4;

export function UrlActionsSection() {
  const queryClient = useQueryClient();
  const actions = useQuery({ queryKey: queryKeys.urlActions, queryFn: urlActionsApi.list });
  const [editing, setEditing] = useState<{ action: UrlActionDto | null } | null>(null);

  const remove = useMutation({
    mutationFn: (action: UrlActionDto) => urlActionsApi.remove(action.id),
    onSuccess: (_, action) => {
      notifySuccess(`URL action ${action.name} excluída.`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.urlActions });
    },
  });

  return (
    <section aria-labelledby="url-actions-title">
      <Group justify="space-between" mb="xs" align="flex-end">
        <div>
          <Title order={3} id="url-actions-title">
            URL actions
          </Title>
          <Text size="sm" c="dimmed">
            Atalhos no menu Ações do agente que abrem uma URL montada com os dados da máquina.
          </Text>
        </div>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing({ action: null })}>
          Nova URL action
        </Button>
      </Group>
      {actions.isError && <LoadError error={actions.error} onRetry={() => void actions.refetch()} />}
      <Paper withBorder>
        <Table.ScrollContainer minWidth={640}>
          <Table striped verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Nome</Table.Th>
                <Table.Th>Descrição</Table.Th>
                <Table.Th>Padrão da URL</Table.Th>
                <Table.Th w={100} aria-label="Ações" />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {actions.isPending && <LoadingRows columns={COLUMNS} rows={3} />}
              {actions.isSuccess && actions.data.length === 0 && <EmptyRow columns={COLUMNS} message="Nenhuma URL action cadastrada." />}
              {actions.data?.map((action) => (
                <Table.Tr key={action.id}>
                  <Table.Td fw={500}>{action.name}</Table.Td>
                  <Table.Td>{action.description}</Table.Td>
                  <Table.Td>
                    <Text size="sm" ff="monospace" style={{ wordBreak: 'break-all' }}>
                      {action.pattern}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap="nowrap" justify="flex-end">
                      <Tooltip label="Editar">
                        <ActionIcon variant="subtle" color="gray" aria-label={`Editar URL action ${action.name}`} onClick={() => setEditing({ action })}>
                          <IconPencil size={16} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Excluir">
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          aria-label={`Excluir URL action ${action.name}`}
                          onClick={() =>
                            confirmAction({
                              title: 'Excluir URL action',
                              message: `Excluir a URL action ${action.name}?`,
                              confirmLabel: 'Excluir',
                              danger: true,
                              onConfirm: () => remove.mutate(action),
                            })
                          }
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
      <Modal opened={editing !== null} onClose={() => setEditing(null)} title={editing?.action ? 'Editar URL action' : 'Nova URL action'} size="lg" centered>
        {editing && <UrlActionForm key={editing.action?.id ?? 'nova'} current={editing.action} onClose={() => setEditing(null)} />}
      </Modal>
    </section>
  );
}

function UrlActionForm({ current, onClose }: { current: UrlActionDto | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const form = useForm<SaveUrlActionRequest>({
    initialValues: { name: current?.name ?? '', description: current?.description ?? '', pattern: current?.pattern ?? '' },
    validate: {
      name: (v) => (v.trim() ? null : 'Informe o nome'),
      pattern: (v) => {
        const value = v.trim();
        if (!value) return 'Informe o padrão da URL';
        if (/^\s*(javascript|data|vbscript):/i.test(value)) return 'Esquema de URL não permitido';
        return null;
      },
    },
  });
  const save = useMutation({
    mutationFn: (body: SaveUrlActionRequest) => (current ? urlActionsApi.update(current.id, body) : urlActionsApi.create(body)),
    onSuccess: async () => {
      notifySuccess(current ? 'URL action atualizada.' : 'URL action criada.');
      await queryClient.invalidateQueries({ queryKey: queryKeys.urlActions });
      onClose();
    },
    onError: (error) => applyServerErrors(form, error),
  });
  return (
    <form
      onSubmit={form.onSubmit((values) => save.mutate({ name: values.name.trim(), description: values.description.trim(), pattern: values.pattern.trim() }))}
      noValidate
    >
      <Stack>
        <TextInput label="Nome" required data-autofocus {...form.getInputProps('name')} />
        <TextInput label="Descrição" {...form.getInputProps('description')} />
        <TextInput
          label="Padrão da URL"
          required
          ff="monospace"
          placeholder="https://exemplo.com/maquina/{{agent.hostname}}"
          {...form.getInputProps('pattern')}
        />
        <TemplateVariablesHint context="no padrão da URL (os valores são codificados para URL)" />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            {current ? 'Salvar' : 'Criar'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
