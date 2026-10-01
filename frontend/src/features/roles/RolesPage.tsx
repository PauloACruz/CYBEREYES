import { useState } from 'react';
import { ActionIcon, Badge, Button, Group, Paper, Table, Text, Tooltip } from '@mantine/core';
import { IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rolesApi } from '../../api/roles';
import type { RoleDto } from '../../api/types';
import { PageHeader } from '../../components/PageHeader';
import { EmptyRow, LoadError, LoadingRows } from '../../components/TableStates';
import { confirmAction, notifySuccess } from '../../lib/feedback';
import { RoleFormModal } from './RoleFormModal';

const COLUMNS = 5;

export function RolesPage() {
  const queryClient = useQueryClient();
  const [formState, setFormState] = useState<{ opened: boolean; role: RoleDto | null }>({ opened: false, role: null });
  const roles = useQuery({ queryKey: ['roles', 'list'], queryFn: () => rolesApi.list() });

  const remove = useMutation({
    mutationFn: (role: RoleDto) => rolesApi.remove(role.id),
    onSuccess: async (_, role) => {
      notifySuccess(`Papel ${role.name} excluído.`);
      await queryClient.invalidateQueries({ queryKey: ['roles'] });
    },
  });

  const confirmRemove = (role: RoleDto) =>
    confirmAction({
      title: 'Excluir papel',
      message:
        role.userCount > 0
          ? `O papel ${role.name} está atribuído a ${role.userCount} ${role.userCount === 1 ? 'usuário' : 'usuários'}, que perderão as permissões dele. Deseja excluir mesmo assim?`
          : `Excluir o papel ${role.name}? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      danger: true,
      onConfirm: () => remove.mutate(role),
    });

  return (
    <>
      <PageHeader
        title="Papéis"
        description="Conjuntos de permissões atribuídos aos usuários."
        actions={
          <Button leftSection={<IconPlus size={16} />} onClick={() => setFormState({ opened: true, role: null })}>
            Novo papel
          </Button>
        }
      />
      {roles.isError && <LoadError error={roles.error} onRetry={() => void roles.refetch()} />}
      <Paper withBorder>
        <Table.ScrollContainer minWidth={640}>
          <Table striped highlightOnHover verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Nome</Table.Th>
                <Table.Th>Tipo</Table.Th>
                <Table.Th>Permissões</Table.Th>
                <Table.Th>Usuários</Table.Th>
                <Table.Th w={100}>
                  <span className="mantine-visually-hidden">Ações</span>
                </Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {roles.isPending && <LoadingRows columns={COLUMNS} rows={3} />}
              {roles.data?.length === 0 && <EmptyRow columns={COLUMNS} message="Nenhum papel cadastrado." />}
              {roles.data?.map((role) => (
                <Table.Tr key={role.id}>
                  <Table.Td fw={500}>{role.name}</Table.Td>
                  <Table.Td>
                    {role.isSuperuser ? (
                      <Badge color="red" variant="light" size="sm">
                        Superusuário
                      </Badge>
                    ) : (
                      <Badge color="gray" variant="light" size="sm">
                        Personalizado
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{role.isSuperuser ? 'Todas' : role.permissions.length}</Text>
                  </Table.Td>
                  <Table.Td>{role.userCount}</Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap="nowrap">
                      <Tooltip label="Editar">
                        <ActionIcon variant="subtle" color="gray" aria-label={`Editar ${role.name}`} onClick={() => setFormState({ opened: true, role })}>
                          <IconPencil size={16} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Excluir">
                        <ActionIcon variant="subtle" color="red" aria-label={`Excluir ${role.name}`} onClick={() => confirmRemove(role)}>
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
      <RoleFormModal opened={formState.opened} role={formState.role} onClose={() => setFormState({ opened: false, role: null })} />
    </>
  );
}
