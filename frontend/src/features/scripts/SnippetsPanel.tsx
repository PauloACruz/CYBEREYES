import { useState } from 'react';
import { ActionIcon, Badge, Button, Code, Group, Modal, Paper, Select, Stack, Table, Text, TextInput, Tooltip } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconEye, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import { scriptsApi } from '../../api/scripts';
import type { SaveSnippetRequest, SnippetDto } from '../../api/types';
import { EmptyRow, LoadError, LoadingRows } from '../../components/TableStates';
import { confirmAction, notifySuccess } from '../../lib/feedback';
import { applyServerErrors } from '../../lib/forms';
import { LazyCodeEditor } from './editor/LazyCodeEditor';
import { editorLanguage, SCRIPT_SHELLS, shellLabel } from './scriptMeta';

type Target = { snippet: SnippetDto | null } | null;

export function SnippetsPanel({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const snippets = useQuery({ queryKey: queryKeys.snippets, queryFn: scriptsApi.snippets });
  const [target, setTarget] = useState<Target>(null);

  const remove = useMutation({
    mutationFn: (snippet: SnippetDto) => scriptsApi.removeSnippet(snippet.id),
    onSuccess: (_, snippet) => {
      notifySuccess(`Snippet ${snippet.name} excluído.`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.snippets });
    },
  });

  const columns = 4;
  return (
    <>
      <Group justify="space-between" mb="md">
        <Text size="sm" c="dimmed">
          Trechos reutilizáveis: no corpo de um script, <Code>{'{{nome_do_snippet}}'}</Code> é substituído pelo código do snippet.
        </Text>
        {canManage && (
          <Button leftSection={<IconPlus size={16} />} onClick={() => setTarget({ snippet: null })}>
            Novo snippet
          </Button>
        )}
      </Group>
      {snippets.isError && <LoadError error={snippets.error} onRetry={() => void snippets.refetch()} />}
      <Paper withBorder>
        <Table.ScrollContainer minWidth={640}>
          <Table striped highlightOnHover verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Nome</Table.Th>
                <Table.Th>Descrição</Table.Th>
                <Table.Th w={160}>Shell</Table.Th>
                <Table.Th w={100} aria-label="Ações" />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {snippets.isPending && <LoadingRows columns={columns} />}
              {snippets.isSuccess && snippets.data.length === 0 && <EmptyRow columns={columns} message="Nenhum snippet cadastrado." />}
              {snippets.data?.map((snippet) => (
                <Table.Tr key={snippet.id}>
                  <Table.Td>
                    <Code>{`{{${snippet.name}}}`}</Code>
                  </Table.Td>
                  <Table.Td>{snippet.description}</Table.Td>
                  <Table.Td>
                    <Badge variant="light" size="sm">
                      {shellLabel(snippet.shell)}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap="nowrap" justify="flex-end">
                      <Tooltip label={canManage ? 'Editar' : 'Ver'}>
                        <ActionIcon variant="subtle" color="gray" aria-label={`${canManage ? 'Editar' : 'Ver'} snippet ${snippet.name}`} onClick={() => setTarget({ snippet })}>
                          {canManage ? <IconPencil size={16} /> : <IconEye size={16} />}
                        </ActionIcon>
                      </Tooltip>
                      {canManage && (
                        <Tooltip label="Excluir">
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            aria-label={`Excluir snippet ${snippet.name}`}
                            onClick={() =>
                              confirmAction({
                                title: 'Excluir snippet',
                                message: `Excluir o snippet ${snippet.name}? Scripts que usam {{${snippet.name}}} deixarão de recebê-lo.`,
                                confirmLabel: 'Excluir',
                                danger: true,
                                onConfirm: () => remove.mutate(snippet),
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
      <Modal
        opened={target !== null}
        onClose={() => setTarget(null)}
        title={target?.snippet ? (canManage ? 'Editar snippet' : 'Ver snippet') : 'Novo snippet'}
        size="xl"
        closeOnClickOutside={false}
      >
        {target && <SnippetForm key={target.snippet?.id ?? 'novo'} snippet={target.snippet} readOnly={!canManage} onClose={() => setTarget(null)} />}
      </Modal>
    </>
  );
}

function SnippetForm({ snippet, readOnly, onClose }: { snippet: SnippetDto | null; readOnly: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const form = useForm<SaveSnippetRequest>({
    initialValues: {
      name: snippet?.name ?? '',
      description: snippet?.description ?? '',
      shell: snippet?.shell ?? 'powershell',
      code: snippet?.code ?? '',
    },
    validate: {
      name: (v) => (/^[A-Za-z0-9_.-]+$/.test(v.trim()) ? null : 'Use letras, números, _, . ou -'),
      code: (v) => (v.trim() ? null : 'O snippet está vazio'),
    },
  });
  const save = useMutation({
    mutationFn: (body: SaveSnippetRequest) => (snippet ? scriptsApi.updateSnippet(snippet.id, body) : scriptsApi.createSnippet(body)),
    onSuccess: async () => {
      notifySuccess(snippet ? 'Snippet atualizado.' : 'Snippet criado.');
      await queryClient.invalidateQueries({ queryKey: queryKeys.snippets });
      onClose();
    },
    onError: (error) => applyServerErrors(form, error),
  });
  return (
    <form onSubmit={form.onSubmit((values) => save.mutate({ ...values, name: values.name.trim() }))} noValidate>
      <Stack>
        <Group grow align="flex-start">
          <TextInput label="Nome" required disabled={readOnly} ff="monospace" data-autofocus {...form.getInputProps('name')} />
          <Select
            label="Shell"
            allowDeselect={false}
            disabled={readOnly}
            data={SCRIPT_SHELLS.map((s) => ({ value: s.value, label: s.label }))}
            value={form.values.shell}
            onChange={(v) => {
              const shell = SCRIPT_SHELLS.find((s) => s.value === v)?.value;
              if (shell) form.setFieldValue('shell', shell);
            }}
          />
        </Group>
        <TextInput label="Descrição" disabled={readOnly} {...form.getInputProps('description')} />
        <div>
          <Text size="sm" fw={500} mb={4}>
            Código
          </Text>
          <LazyCodeEditor
            value={form.values.code}
            onChange={(v) => form.setFieldValue('code', v)}
            language={editorLanguage(form.values.shell)}
            readOnly={readOnly}
            height={320}
            ariaLabel="Código do snippet"
          />
          {form.errors.code && (
            <Text size="xs" c="red" mt={4}>
              {form.errors.code}
            </Text>
          )}
        </div>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {readOnly ? 'Fechar' : 'Cancelar'}
          </Button>
          {!readOnly && (
            <Button type="submit" loading={save.isPending}>
              {snippet ? 'Salvar' : 'Criar snippet'}
            </Button>
          )}
        </Group>
      </Stack>
    </form>
  );
}
