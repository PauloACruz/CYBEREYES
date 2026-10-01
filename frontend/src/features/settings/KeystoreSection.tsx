import { useState } from 'react';
import { ActionIcon, Button, Code, Group, Modal, Paper, PasswordInput, Stack, Table, Text, TextInput, Title, Tooltip } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconEye, IconEyeOff, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import { keystoreApi } from '../../api/settings';
import type { KeyDto, SaveKeyRequest } from '../../api/types';
import { EmptyRow, LoadError, LoadingRows } from '../../components/TableStates';
import { confirmAction, notifySuccess } from '../../lib/feedback';
import { applyServerErrors } from '../../lib/forms';

const MASK = '••••••••';
const COLUMNS = 3;

export function KeystoreSection() {
  const queryClient = useQueryClient();
  const keys = useQuery({ queryKey: queryKeys.keystore, queryFn: keystoreApi.list });
  const [revealed, setRevealed] = useState<ReadonlySet<number>>(new Set());
  const [editing, setEditing] = useState<{ key: KeyDto | null } | null>(null);

  const toggle = (id: number) =>
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const remove = useMutation({
    mutationFn: (key: KeyDto) => keystoreApi.remove(key.id),
    onSuccess: (_, key) => {
      notifySuccess(`Chave ${key.name} excluída.`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.keystore });
    },
  });

  return (
    <section aria-labelledby="keystore-title">
      <Group justify="space-between" mb="xs" align="flex-end">
        <div>
          <Title order={3} id="keystore-title">
            Keystore global
          </Title>
          <Text size="sm" c="dimmed">
            Valores usados em scripts e URL actions com <Code>{'{{global.NOME}}'}</Code>.
          </Text>
        </div>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing({ key: null })}>
          Nova chave
        </Button>
      </Group>
      {keys.isError && <LoadError error={keys.error} onRetry={() => void keys.refetch()} />}
      <Paper withBorder>
        <Table.ScrollContainer minWidth={560}>
          <Table striped verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Nome</Table.Th>
                <Table.Th>Valor</Table.Th>
                <Table.Th w={130} aria-label="Ações" />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {keys.isPending && <LoadingRows columns={COLUMNS} rows={3} />}
              {keys.isSuccess && keys.data.length === 0 && <EmptyRow columns={COLUMNS} message="Nenhuma chave cadastrada." />}
              {keys.data?.map((key) => {
                const shown = revealed.has(key.id);
                return (
                  <Table.Tr key={key.id}>
                    <Table.Td>
                      <Code>{key.name}</Code>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" ff="monospace" style={{ wordBreak: 'break-all' }}>
                        {shown ? key.value : MASK}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4} wrap="nowrap" justify="flex-end">
                        <Tooltip label={shown ? 'Ocultar valor' : 'Mostrar valor'}>
                          <ActionIcon variant="subtle" color="gray" aria-label={`${shown ? 'Ocultar' : 'Mostrar'} valor de ${key.name}`} onClick={() => toggle(key.id)}>
                            {shown ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Editar">
                          <ActionIcon variant="subtle" color="gray" aria-label={`Editar chave ${key.name}`} onClick={() => setEditing({ key })}>
                            <IconPencil size={16} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Excluir">
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            aria-label={`Excluir chave ${key.name}`}
                            onClick={() =>
                              confirmAction({
                                title: 'Excluir chave',
                                message: `Excluir ${key.name}? Scripts e URL actions que usam {{global.${key.name}}} deixarão de recebê-la.`,
                                confirmLabel: 'Excluir',
                                danger: true,
                                onConfirm: () => remove.mutate(key),
                              })
                            }
                          >
                            <IconTrash size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
      <Modal opened={editing !== null} onClose={() => setEditing(null)} title={editing?.key ? 'Editar chave' : 'Nova chave'} centered>
        {editing && <KeyForm key={editing.key?.id ?? 'nova'} current={editing.key} onClose={() => setEditing(null)} />}
      </Modal>
    </section>
  );
}

function KeyForm({ current, onClose }: { current: KeyDto | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const form = useForm<SaveKeyRequest>({
    initialValues: { name: current?.name ?? '', value: current?.value ?? '' },
    validate: {
      name: (v) => (/^[A-Za-z0-9_]+$/.test(v.trim()) ? null : 'Use apenas letras, números e _'),
      value: (v) => (v === '' ? 'Informe o valor' : null),
    },
  });
  const save = useMutation({
    mutationFn: (body: SaveKeyRequest) => (current ? keystoreApi.update(current.id, body) : keystoreApi.create(body)),
    onSuccess: async () => {
      notifySuccess(current ? 'Chave atualizada.' : 'Chave criada.');
      await queryClient.invalidateQueries({ queryKey: queryKeys.keystore });
      onClose();
    },
    onError: (error) => applyServerErrors(form, error),
  });
  return (
    <form onSubmit={form.onSubmit((values) => save.mutate({ ...values, name: values.name.trim() }))} noValidate>
      <Stack>
        <TextInput label="Nome" required ff="monospace" data-autofocus description="Letras, números e _" {...form.getInputProps('name')} />
        <PasswordInput label="Valor" required autoComplete="off" {...form.getInputProps('value')} />
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
