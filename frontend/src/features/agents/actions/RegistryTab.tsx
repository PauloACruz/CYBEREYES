import { useMemo, useState } from 'react';
import {
  ActionIcon,
  Anchor,
  Breadcrumbs,
  Button,
  Group,
  Menu,
  Modal,
  NavLink,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import {
  IconArrowUp,
  IconDotsVertical,
  IconFolder,
  IconFolderPlus,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconCursorText,
} from '@tabler/icons-react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { agentActionsApi } from '../../../api/agentActions';
import { queryKeys } from '../../../api/queryKeys';
import type { AgentDetail, RegistrySubkey, RegistryValue, RegistryValueRequest, RegistryValueType } from '../../../api/types';
import { EmptyRow, LoadError } from '../../../components/TableStates';
import { confirmAction, notifySuccess } from '../../../lib/feedback';
import { joinPath, normalizePath, parentPath, pathSegments } from './registryPath';

const VALUE_TYPES: readonly RegistryValueType[] = ['REG_SZ', 'REG_EXPAND_SZ', 'REG_MULTI_SZ', 'REG_DWORD', 'REG_QWORD', 'REG_BINARY'];

function valueLabel(name: string): string {
  return name === '' ? '(Padrão)' : name;
}

function validateData(type: RegistryValueType, data: string): string | null {
  const trimmed = data.trim();
  if (type === 'REG_DWORD' || type === 'REG_QWORD') {
    if (!/^(0x[0-9a-f]+|\d+)$/i.test(trimmed)) return 'Informe um número decimal ou hexadecimal (0x...)';
    const max = type === 'REG_DWORD' ? 0xffffffffn : 0xffffffffffffffffn;
    if (BigInt(trimmed) > max) return type === 'REG_DWORD' ? 'Valor maior que 32 bits' : 'Valor maior que 64 bits';
  }
  if (type === 'REG_BINARY' && trimmed && !/^([0-9a-f]{2}[\s,]*)+$/i.test(trimmed)) return 'Informe bytes em hexadecimal (ex.: 01 a0 ff)';
  return null;
}

type NamePrompt = { title: string; label: string; initial: string; submit: string; onSave: (name: string) => Promise<unknown> };
type ValueEdit = { mode: 'create' | 'edit'; value: RegistryValue | null };

export function RegistryTab({ agent, canControl }: { agent: AgentDetail; canControl: boolean }) {
  const queryClient = useQueryClient();
  const [path, setPath] = useState('');
  const [jump, setJump] = useState('');
  const [prompt, setPrompt] = useState<NamePrompt | null>(null);
  const [valueEdit, setValueEdit] = useState<ValueEdit | null>(null);

  const listing = useInfiniteQuery({
    queryKey: queryKeys.agentRegistry(agent.id, path),
    queryFn: ({ pageParam }) => agentActionsApi.registry(agent.id, path, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => (last.hasMore ? pages.length + 1 : undefined),
    retry: false,
  });

  const subkeys = useMemo<RegistrySubkey[]>(() => listing.data?.pages.flatMap((p) => p.subkeys) ?? [], [listing.data]);
  const values = useMemo<RegistryValue[]>(() => listing.data?.pages.flatMap((p) => p.values) ?? [], [listing.data]);
  const atRoot = path === '';

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['agent-live', agent.id, 'registry'] });
  const done = (message: string) => {
    notifySuccess(message);
    void invalidate();
  };

  const navigate = (next: string) => {
    setPath(next);
    setJump(next);
  };

  const deleteKey = useMutation({
    mutationFn: (keyPath: string) => agentActionsApi.deleteKey(agent.id, keyPath),
    onSuccess: () => done('Chave excluída.'),
  });
  const deleteValue = useMutation({
    mutationFn: (name: string) => agentActionsApi.deleteValue(agent.id, path, name),
    onSuccess: () => done('Valor excluído.'),
  });

  const newKey = () =>
    setPrompt({
      title: 'Nova chave',
      label: 'Nome da chave',
      initial: '',
      submit: 'Criar',
      onSave: async (name) => {
        await agentActionsApi.createKey(agent.id, joinPath(path, name));
        done('Chave criada.');
      },
    });

  const renameKey = (key: RegistrySubkey) =>
    setPrompt({
      title: 'Renomear chave',
      label: 'Novo nome',
      initial: key.name,
      submit: 'Renomear',
      onSave: async (name) => {
        await agentActionsApi.renameKey(agent.id, joinPath(path, key.name), joinPath(path, name));
        done('Chave renomeada.');
      },
    });

  const renameValue = (value: RegistryValue) =>
    setPrompt({
      title: 'Renomear valor',
      label: 'Novo nome',
      initial: value.name,
      submit: 'Renomear',
      onSave: async (name) => {
        await agentActionsApi.renameValue(agent.id, path, value.name, name);
        done('Valor renomeado.');
      },
    });

  const confirmDeleteKey = (key: RegistrySubkey) => {
    const full = joinPath(path, key.name);
    confirmAction({
      title: 'Excluir chave',
      message: `Excluir a chave ${full} e todo o seu conteúdo? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir chave',
      danger: true,
      onConfirm: () => deleteKey.mutate(full),
    });
  };

  const confirmDeleteValue = (value: RegistryValue) =>
    confirmAction({
      title: 'Excluir valor',
      message: `Excluir o valor ${valueLabel(value.name)} de ${path}? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir valor',
      danger: true,
      onConfirm: () => deleteValue.mutate(value.name),
    });

  return (
    <Stack>
      <Group justify="space-between" wrap="wrap" gap="sm">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            navigate(normalizePath(jump));
          }}
          style={{ flex: 1, minWidth: 260 }}
        >
          <TextInput
            aria-label="Caminho da chave"
            placeholder="Ex.: HKLM\SOFTWARE\Microsoft"
            ff="monospace"
            value={jump}
            onChange={(e) => setJump(e.currentTarget.value)}
            rightSectionWidth={60}
            rightSection={
              <Button type="submit" size="compact-xs" variant="light">
                Ir
              </Button>
            }
          />
        </form>
        <Group gap="xs">
          <Button variant="default" leftSection={<IconArrowUp size={16} />} disabled={atRoot} onClick={() => navigate(parentPath(path))}>
            Subir
          </Button>
          <Button variant="light" leftSection={<IconRefresh size={16} />} loading={listing.isFetching && !listing.isFetchingNextPage} onClick={() => void listing.refetch()}>
            Atualizar
          </Button>
          {canControl && !atRoot && (
            <>
              <Button variant="light" leftSection={<IconFolderPlus size={16} />} onClick={newKey}>
                Nova chave
              </Button>
              <Button variant="light" leftSection={<IconPlus size={16} />} onClick={() => setValueEdit({ mode: 'create', value: null })}>
                Novo valor
              </Button>
            </>
          )}
        </Group>
      </Group>

      <Breadcrumbs separator="\" aria-label="Caminho atual">
        <Anchor component="button" type="button" size="sm" onClick={() => navigate('')}>
          Computador
        </Anchor>
        {pathSegments(path).map((seg) => (
          <Anchor key={seg.path} component="button" type="button" size="sm" ff="monospace" onClick={() => navigate(seg.path)}>
            {seg.name}
          </Anchor>
        ))}
      </Breadcrumbs>

      {listing.isError && <LoadError error={listing.error} onRetry={() => void listing.refetch()} />}

      <SimpleGrid cols={{ base: 1, md: atRoot ? 1 : 2 }} spacing="md" style={{ alignItems: 'start' }}>
        <Paper withBorder p="xs">
          <Title order={5} px="xs" py={4}>
            {atRoot ? 'Raízes' : 'Subchaves'}
          </Title>
          <ScrollArea.Autosize mah={520}>
            {listing.isPending && (
              <Text size="sm" c="dimmed" p="sm">
                Carregando...
              </Text>
            )}
            {listing.isSuccess && subkeys.length === 0 && (
              <Text size="sm" c="dimmed" p="sm">
                Nenhuma subchave.
              </Text>
            )}
            {subkeys.map((key) => (
              <Group key={key.name} gap={4} wrap="nowrap">
                <NavLink
                  label={key.name}
                  leftSection={<IconFolder size={16} />}
                  onClick={() => navigate(joinPath(path, key.name))}
                  description={key.hasSubkeys ? undefined : 'Sem subchaves'}
                  style={{ borderRadius: 'var(--mantine-radius-sm)' }}
                  styles={{ label: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
                />
                {canControl && !atRoot && (
                  <Menu position="bottom-end" withinPortal>
                    <Menu.Target>
                      <ActionIcon variant="subtle" color="gray" aria-label={`Ações da chave ${key.name}`}>
                        <IconDotsVertical size={16} />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item leftSection={<IconCursorText size={14} />} onClick={() => renameKey(key)}>
                        Renomear
                      </Menu.Item>
                      <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={() => confirmDeleteKey(key)}>
                        Excluir
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                )}
              </Group>
            ))}
          </ScrollArea.Autosize>
        </Paper>

        {!atRoot && (
          <Paper withBorder>
            <Title order={5} px="md" pt="sm" pb={4}>
              Valores
            </Title>
            <Table.ScrollContainer minWidth={480}>
              <Table verticalSpacing="xs" striped>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Nome</Table.Th>
                    <Table.Th w={140}>Tipo</Table.Th>
                    <Table.Th>Dados</Table.Th>
                    {canControl && <Table.Th w={50} aria-label="Ações" />}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {listing.isSuccess && values.length === 0 && <EmptyRow columns={canControl ? 4 : 3} message="Nenhum valor nesta chave." />}
                  {values.map((value) => (
                    <Table.Tr key={value.name}>
                      <Table.Td ff="monospace" fw={500}>
                        {valueLabel(value.name)}
                      </Table.Td>
                      <Table.Td ff="monospace" fz="xs">
                        {value.type}
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" ff="monospace" lineClamp={3} style={{ wordBreak: 'break-all' }}>
                          {value.data}
                        </Text>
                      </Table.Td>
                      {canControl && (
                        <Table.Td>
                          <Menu position="bottom-end" withinPortal>
                            <Menu.Target>
                              <ActionIcon variant="subtle" color="gray" aria-label={`Ações do valor ${valueLabel(value.name)}`}>
                                <IconDotsVertical size={16} />
                              </ActionIcon>
                            </Menu.Target>
                            <Menu.Dropdown>
                              <Menu.Item leftSection={<IconPencil size={14} />} onClick={() => setValueEdit({ mode: 'edit', value })}>
                                Editar dados
                              </Menu.Item>
                              <Menu.Item leftSection={<IconCursorText size={14} />} disabled={value.name === ''} onClick={() => renameValue(value)}>
                                Renomear
                              </Menu.Item>
                              <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={() => confirmDeleteValue(value)}>
                                Excluir
                              </Menu.Item>
                            </Menu.Dropdown>
                          </Menu>
                        </Table.Td>
                      )}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Paper>
        )}
      </SimpleGrid>

      {listing.hasNextPage && (
        <Group justify="center">
          <Button variant="default" loading={listing.isFetchingNextPage} onClick={() => void listing.fetchNextPage()}>
            Carregar mais
          </Button>
        </Group>
      )}

      <Modal opened={prompt !== null} onClose={() => setPrompt(null)} title={prompt?.title} centered>
        {prompt && <NamePromptForm key={prompt.title + prompt.initial} prompt={prompt} onClose={() => setPrompt(null)} />}
      </Modal>
      <Modal
        opened={valueEdit !== null}
        onClose={() => setValueEdit(null)}
        title={valueEdit?.mode === 'edit' ? 'Editar valor' : 'Novo valor'}
        centered
        size="lg"
      >
        {valueEdit && (
          <ValueForm
            key={valueEdit.value?.name ?? '__novo__'}
            path={path}
            edit={valueEdit}
            onClose={() => setValueEdit(null)}
            onSave={async (body) => {
              if (valueEdit.mode === 'edit') await agentActionsApi.updateValue(agent.id, body);
              else await agentActionsApi.createValue(agent.id, body);
              done(valueEdit.mode === 'edit' ? 'Valor alterado.' : 'Valor criado.');
            }}
          />
        )}
      </Modal>
    </Stack>
  );
}

function NamePromptForm({ prompt, onClose }: { prompt: NamePrompt; onClose: () => void }) {
  const form = useForm({
    initialValues: { name: prompt.initial },
    validate: {
      name: (v) => {
        if (!v.trim()) return 'Informe o nome';
        if (v.includes('\\')) return 'O nome não pode conter \\';
        return null;
      },
    },
  });
  const save = useMutation({ mutationFn: (name: string) => prompt.onSave(name), onSuccess: onClose });
  return (
    <form onSubmit={form.onSubmit((values) => save.mutate(values.name.trim()))} noValidate>
      <Stack>
        <TextInput label={prompt.label} required data-autofocus ff="monospace" {...form.getInputProps('name')} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            {prompt.submit}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

interface ValueFormProps {
  path: string;
  edit: ValueEdit;
  onClose: () => void;
  onSave: (body: RegistryValueRequest) => Promise<void>;
}

function ValueForm({ path, edit, onClose, onSave }: ValueFormProps) {
  const current = edit.value;
  const initialType: RegistryValueType = VALUE_TYPES.find((t) => t === current?.type) ?? 'REG_SZ';
  const form = useForm({
    initialValues: { name: current?.name ?? '', type: initialType, data: current?.data ?? '' },
    validate: {
      name: (v) => (edit.mode === 'create' && !v.trim() ? 'Informe o nome' : null),
      data: (v, values) => validateData(values.type, v),
    },
  });
  const save = useMutation({ mutationFn: onSave, onSuccess: onClose });
  const isMulti = form.values.type === 'REG_MULTI_SZ';
  return (
    <form
      onSubmit={form.onSubmit((values) =>
        confirmAction({
          title: edit.mode === 'edit' ? 'Salvar alteração' : 'Criar valor',
          message: `${edit.mode === 'edit' ? 'Alterar' : 'Criar'} o valor ${valueLabel(values.name)} em ${path}?`,
          confirmLabel: 'Confirmar',
          onConfirm: () => save.mutate({ path, name: values.name, type: values.type, data: values.data }),
        }),
      )}
      noValidate
    >
      <Stack>
        <Text size="sm" c="dimmed" ff="monospace">
          {path}
        </Text>
        <TextInput label="Nome" ff="monospace" required={edit.mode === 'create'} disabled={edit.mode === 'edit'} data-autofocus {...form.getInputProps('name')} />
        <Select
          label="Tipo"
          data={VALUE_TYPES.map((t) => ({ value: t, label: t }))}
          allowDeselect={false}
          disabled={edit.mode === 'edit'}
          {...form.getInputProps('type')}
        />
        <Textarea
          label="Dados"
          description={isMulti ? 'Uma entrada por linha' : form.values.type === 'REG_BINARY' ? 'Bytes em hexadecimal separados por espaço' : undefined}
          autosize
          minRows={isMulti ? 4 : 2}
          maxRows={14}
          styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
          {...form.getInputProps('data')}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            {edit.mode === 'edit' ? 'Salvar' : 'Criar'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
