import { useMemo, useState } from 'react';
import { ActionIcon, Badge, Button, Group, Paper, Select, SimpleGrid, Table, Tabs, Text, TextInput, Tooltip } from '@mantine/core';
import { IconCode, IconEye, IconPencil, IconPlus, IconPuzzle, IconSearch, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import { scriptsApi } from '../../api/scripts';
import { PERMISSIONS, type ScriptDto } from '../../api/types';
import { hasPermission } from '../../auth/permissions';
import { useMe } from '../../auth/useMe';
import { PageHeader } from '../../components/PageHeader';
import { EmptyRow, LoadError, LoadingRows } from '../../components/TableStates';
import { confirmAction, notifySuccess } from '../../lib/feedback';
import { formatDateTime } from '../../lib/format';
import { ScriptEditorModal, type ScriptEditorTarget } from './ScriptEditorModal';
import { platformLabel, SCRIPT_PLATFORMS, SCRIPT_SHELLS, shellLabel, supportsPlatform } from './scriptMeta';
import { SnippetsPanel } from './SnippetsPanel';

const COLUMNS = 6;

export function ScriptsPage() {
  const { data: me } = useMe();
  const canManage = hasPermission(me, PERMISSIONS.scriptsManage);
  const queryClient = useQueryClient();
  const scripts = useQuery({ queryKey: queryKeys.scripts, queryFn: scriptsApi.list });
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [shell, setShell] = useState<string | null>(null);
  const [platform, setPlatform] = useState<string | null>(null);
  const [editor, setEditor] = useState<ScriptEditorTarget | null>(null);

  const categories = useMemo(
    () => [...new Set((scripts.data ?? []).map((s) => s.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [scripts.data],
  );

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (scripts.data ?? [])
      .filter((s) => !category || s.category === category)
      .filter((s) => !shell || s.shell === shell)
      .filter((s) => !platform || supportsPlatform(s, platform))
      .filter((s) => !term || s.name.toLowerCase().includes(term) || s.description.toLowerCase().includes(term))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [scripts.data, search, category, shell, platform]);

  const remove = useMutation({
    mutationFn: (script: ScriptDto) => scriptsApi.remove(script.id),
    onSuccess: (_, script) => {
      notifySuccess(`Script ${script.name} excluído.`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.scripts });
    },
  });

  const confirmRemove = (script: ScriptDto) =>
    confirmAction({
      title: 'Excluir script',
      message: `Excluir o script ${script.name}? O histórico de execuções é mantido.`,
      confirmLabel: 'Excluir',
      danger: true,
      onConfirm: () => remove.mutate(script),
    });

  const hasFilters = Boolean(search.trim() || category || shell || platform);

  return (
    <>
      <PageHeader
        title="Scripts"
        description="Biblioteca de scripts para executar nos agentes."
        actions={
          canManage && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setEditor({ mode: 'create' })}>
              Novo script
            </Button>
          )
        }
      />
      <Tabs defaultValue="scripts" keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="scripts" leftSection={<IconCode size={16} />}>
            Scripts
          </Tabs.Tab>
          <Tabs.Tab value="snippets" leftSection={<IconPuzzle size={16} />}>
            Snippets
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="scripts">
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} mb="md">
            <TextInput
              label="Busca"
              placeholder="Nome ou descrição"
              leftSection={<IconSearch size={16} />}
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
            />
            <Select label="Categoria" placeholder="Todas" clearable data={categories} value={category} onChange={setCategory} />
            <Select
              label="Shell"
              placeholder="Todos"
              clearable
              data={SCRIPT_SHELLS.map((s) => ({ value: s.value, label: s.label }))}
              value={shell}
              onChange={setShell}
            />
            <Select
              label="Plataforma"
              placeholder="Todas"
              clearable
              data={SCRIPT_PLATFORMS.map((p) => ({ value: p.value, label: p.label }))}
              value={platform}
              onChange={setPlatform}
            />
          </SimpleGrid>
          {scripts.isError && <LoadError error={scripts.error} onRetry={() => void scripts.refetch()} />}
          <Paper withBorder>
            <Table.ScrollContainer minWidth={860}>
              <Table striped highlightOnHover verticalSpacing="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Nome</Table.Th>
                    <Table.Th>Categoria</Table.Th>
                    <Table.Th>Shell</Table.Th>
                    <Table.Th>Plataformas</Table.Th>
                    <Table.Th w={150}>Atualizado em</Table.Th>
                    <Table.Th w={100} aria-label="Ações" />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {scripts.isPending && <LoadingRows columns={COLUMNS} />}
                  {scripts.isSuccess && rows.length === 0 && (
                    <EmptyRow columns={COLUMNS} message={hasFilters ? 'Nenhum script encontrado com estes filtros.' : 'Nenhum script cadastrado.'} />
                  )}
                  {rows.map((script) => (
                    <Table.Tr key={script.id}>
                      <Table.Td>
                        <Text size="sm" fw={500}>
                          {script.name}
                        </Text>
                        {script.description && (
                          <Text size="xs" c="dimmed" lineClamp={1}>
                            {script.description}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>{script.category || <Text size="sm" c="dimmed">Sem categoria</Text>}</Table.Td>
                      <Table.Td>{shellLabel(script.shell)}</Table.Td>
                      <Table.Td>
                        <Group gap={4}>
                          {script.platforms.map((p) => (
                            <Badge key={p} size="sm" variant="light" color="gray">
                              {platformLabel(p)}
                            </Badge>
                          ))}
                        </Group>
                      </Table.Td>
                      <Table.Td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(script.updatedAt, '')}</Table.Td>
                      <Table.Td>
                        <Group gap={4} wrap="nowrap" justify="flex-end">
                          <Tooltip label={canManage ? 'Editar' : 'Ver'}>
                            <ActionIcon
                              variant="subtle"
                              color="gray"
                              aria-label={`${canManage ? 'Editar' : 'Ver'} script ${script.name}`}
                              onClick={() => setEditor({ mode: 'edit', id: script.id })}
                            >
                              {canManage ? <IconPencil size={16} /> : <IconEye size={16} />}
                            </ActionIcon>
                          </Tooltip>
                          {canManage && (
                            <Tooltip label="Excluir">
                              <ActionIcon variant="subtle" color="red" aria-label={`Excluir script ${script.name}`} onClick={() => confirmRemove(script)}>
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
          {scripts.data && (
            <Text size="sm" c="dimmed" mt="md">
              {rows.length} de {scripts.data.length} scripts
            </Text>
          )}
        </Tabs.Panel>
        <Tabs.Panel value="snippets">
          <SnippetsPanel canManage={canManage} />
        </Tabs.Panel>
      </Tabs>
      <ScriptEditorModal target={editor} readOnly={!canManage} categories={categories} onClose={() => setEditor(null)} />
    </>
  );
}
