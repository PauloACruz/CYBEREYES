import { useState } from 'react';
import { ActionIcon, Anchor, Badge, Button, Group, Pagination, Paper, SegmentedControl, Select, Table, Text, TextInput, Tooltip } from '@mantine/core';
import { useDebouncedCallback } from '@mantine/hooks';
import { IconPencil, IconPlus, IconSearch, IconTrash } from '@tabler/icons-react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { peopleApi } from '../../api/inventory';
import { queryKeys } from '../../api/queryKeys';
import { PERMISSIONS, type ListPeopleParams, type PersonListItem } from '../../api/types';
import { personPath } from '../../app/paths';
import { hasPermission } from '../../auth/permissions';
import { useMe } from '../../auth/useMe';
import { PageHeader } from '../../components/PageHeader';
import { EmptyRow, LoadError, LoadingRows } from '../../components/TableStates';
import { confirmAction, notifySuccess } from '../../lib/feedback';
import { totalPages } from '../../lib/format';
import { useClients } from '../clients/useClients';
import { InventoryTabs } from './InventoryTabs';
import { toId } from './inventoryFormat';
import { notifyPersonDeleteError } from './personActions';
import { PersonFormModal } from './PersonFormModal';

const PAGE_SIZE = 50;
const COLUMNS = 8;

const ACTIVE_OPTIONS = [
  { value: 'ativas', label: 'Ativas' },
  { value: 'inativas', label: 'Inativas' },
  { value: 'todas', label: 'Todas' },
];

type Editing = { mode: 'new' } | { mode: 'edit'; person: PersonListItem } | null;

export function PeoplePage() {
  const { data: me } = useMe();
  const canManage = hasPermission(me, PERMISSIONS.inventoryManage);
  const queryClient = useQueryClient();
  const clients = useClients();
  const [searchParams, setSearchParams] = useSearchParams();
  const [editing, setEditing] = useState<Editing>(null);
  const currentSearch = searchParams.get('busca') ?? '';
  const [search, setSearch] = useState(currentSearch);
  const activeParam = searchParams.get('situacao');
  const activeValue = activeParam === 'inativas' || activeParam === 'todas' ? activeParam : 'ativas';

  const params: ListPeopleParams = {
    clientId: toId(searchParams.get('cliente')),
    search: currentSearch || undefined,
    active: activeValue === 'todas' ? undefined : activeValue === 'ativas',
    page: toId(searchParams.get('pagina')) ?? 1,
    pageSize: PAGE_SIZE,
  };

  const updateParams = (changes: Record<string, string | undefined>) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        if (!('pagina' in changes)) next.delete('pagina');
        return next;
      },
      { replace: true },
    );
  };
  const applySearch = useDebouncedCallback((value: string) => updateParams({ busca: value.trim() || undefined }), 300);

  const people = useQuery({
    queryKey: queryKeys.peopleList(params),
    queryFn: () => peopleApi.list(params),
    placeholderData: keepPreviousData,
  });

  const remove = useMutation({
    mutationFn: (id: number) => peopleApi.remove(id, { silent: true }),
    onSuccess: () => {
      notifySuccess('Pessoa excluída.');
      void queryClient.invalidateQueries({ queryKey: queryKeys.people });
    },
    onError: notifyPersonDeleteError,
  });

  return (
    <>
      <PageHeader
        title="Inventário"
        description="Pessoas dos clientes que respondem pelos equipamentos."
        actions={
          canManage && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing({ mode: 'new' })}>
              Nova pessoa
            </Button>
          )
        }
      />
      <InventoryTabs active="pessoas" />
      <Group mb="md" gap="sm" align="flex-end" wrap="wrap">
        <TextInput
          placeholder="Nome, e-mail, usuário ou departamento"
          aria-label="Buscar pessoas"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => {
            setSearch(e.currentTarget.value);
            applySearch(e.currentTarget.value);
          }}
          w={300}
        />
        <Select
          aria-label="Filtrar por cliente"
          placeholder="Todos os clientes"
          clearable
          searchable
          data={(clients.data ?? []).map((c) => ({ value: String(c.id), label: c.name }))}
          value={params.clientId ? String(params.clientId) : null}
          onChange={(v) => updateParams({ cliente: v ?? undefined })}
          w={200}
        />
        <SegmentedControl
          aria-label="Situação"
          data={ACTIVE_OPTIONS}
          value={activeValue}
          onChange={(v) => updateParams({ situacao: v === 'ativas' ? undefined : v })}
        />
      </Group>

      {people.isError && <LoadError error={people.error} onRetry={() => void people.refetch()} />}
      <Paper withBorder style={{ opacity: people.isPlaceholderData ? 0.6 : 1 }}>
        <Table.ScrollContainer minWidth={1000}>
          <Table verticalSpacing="xs" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Nome</Table.Th>
                <Table.Th w={170}>Departamento</Table.Th>
                <Table.Th w={150}>Cargo</Table.Th>
                <Table.Th w={150}>Usuário</Table.Th>
                <Table.Th w={200}>E-mail</Table.Th>
                <Table.Th w={80}>Ativos</Table.Th>
                <Table.Th w={90}>Situação</Table.Th>
                <Table.Th w={80} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {people.isPending && <LoadingRows columns={COLUMNS} />}
              {people.data && people.data.items.length === 0 && <EmptyRow columns={COLUMNS} message="Nenhuma pessoa encontrada." />}
              {people.data?.items.map((person) => (
                <Table.Tr key={person.id}>
                  <Table.Td>
                    <Anchor component={Link} to={personPath(person.id)} size="sm" fw={600}>
                      {person.name}
                    </Anchor>
                    <Text size="xs" c="dimmed">
                      {person.clientName}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{person.department ?? ''}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{person.jobTitle ?? ''}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" ff="monospace">
                      {person.username ?? ''}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" truncate>
                      {person.email ?? ''}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{person.assetCount}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="light" color={person.active ? 'teal' : 'gray'} size="sm">
                      {person.active ? 'Ativa' : 'Inativa'}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    {canManage && (
                      <Group gap={4} wrap="nowrap" justify="flex-end">
                        <Tooltip label="Editar">
                          <ActionIcon variant="subtle" color="gray" aria-label={`Editar ${person.name}`} onClick={() => setEditing({ mode: 'edit', person })}>
                            <IconPencil size={16} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Excluir">
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            aria-label={`Excluir ${person.name}`}
                            onClick={() =>
                              confirmAction({
                                title: 'Excluir pessoa',
                                message: `Excluir ${person.name}? Pessoas com ativos atribuídos só podem ser desativadas.`,
                                confirmLabel: 'Excluir',
                                danger: true,
                                onConfirm: () => remove.mutate(person.id),
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
      {people.data && (
        <Group justify="space-between" mt="md">
          <Text size="sm" c="dimmed">
            {people.data.total} {people.data.total === 1 ? 'pessoa' : 'pessoas'}
          </Text>
          <Pagination
            total={totalPages(people.data.total, PAGE_SIZE)}
            value={params.page}
            onChange={(p) => updateParams({ pagina: p > 1 ? String(p) : undefined })}
            size="sm"
          />
        </Group>
      )}

      {canManage && (
        <PersonFormModal
          opened={editing !== null}
          onClose={() => setEditing(null)}
          person={editing?.mode === 'edit' ? editing.person : undefined}
        />
      )}
    </>
  );
}
