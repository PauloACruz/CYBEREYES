import { useState } from 'react';
import { ActionIcon, Badge, Button, Group, Menu, Pagination, Paper, Table, Text, TextInput, Tooltip } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import {
  IconDots,
  IconKey,
  IconMailForward,
  IconPencil,
  IconPlus,
  IconSearch,
  IconShieldOff,
  IconTrash,
} from '@tabler/icons-react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usersApi } from '../../api/users';
import { PERMISSIONS, type UserDto } from '../../api/types';
import { hasPermission } from '../../auth/permissions';
import { useMe } from '../../auth/useMe';
import { PageHeader } from '../../components/PageHeader';
import { EmptyRow, LoadError, LoadingRows } from '../../components/TableStates';
import { confirmAction, notifySuccess } from '../../lib/feedback';
import { formatDateTime, totalPages } from '../../lib/format';
import { ResetPasswordModal } from './ResetPasswordModal';
import { UserFormModal } from './UserFormModal';

const PAGE_SIZE = 25;
const COLUMNS = 8;

export function UsersPage() {
  const { data: me } = useMe();
  const canManage = hasPermission(me, PERMISSIONS.usersManage);
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch] = useDebouncedValue(search.trim(), 300);
  const [formState, setFormState] = useState<{ opened: boolean; user: UserDto | null }>({ opened: false, user: null });
  const [resetPasswordUser, setResetPasswordUser] = useState<UserDto | null>(null);

  const params = { page, pageSize: PAGE_SIZE, search: debouncedSearch || undefined };
  const users = useQuery({
    queryKey: ['users', params],
    queryFn: () => usersApi.list(params),
    placeholderData: keepPreviousData,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['users'] });

  const reset2fa = useMutation({
    mutationFn: (user: UserDto) => usersApi.resetTwoFactor(user.id),
    onSuccess: async (_, user) => {
      notifySuccess(`${user.username} precisará configurar a verificação em duas etapas no próximo acesso.`);
      await invalidate();
    },
  });
  const resendInvite = useMutation({
    mutationFn: (user: UserDto) => usersApi.resendInvite(user.id),
    onSuccess: (_, user) => notifySuccess(`Convite reenviado para ${user.email}. O link anterior deixou de valer.`),
  });
  const remove = useMutation({
    mutationFn: (user: UserDto) => usersApi.remove(user.id),
    onSuccess: async (_, user) => {
      notifySuccess(`Usuário ${user.username} excluído.`);
      await invalidate();
    },
  });

  const rows = users.data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Usuários"
        description="Técnicos e administradores com acesso ao console."
        actions={
          canManage && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setFormState({ opened: true, user: null })}>
              Novo usuário
            </Button>
          )
        }
      />
      <TextInput
        placeholder="Buscar por usuário, nome ou e-mail"
        aria-label="Buscar usuários"
        leftSection={<IconSearch size={16} />}
        value={search}
        onChange={(e) => {
          setSearch(e.currentTarget.value);
          setPage(1);
        }}
        mb="md"
        maw={420}
      />
      {users.isError && <LoadError error={users.error} onRetry={() => void users.refetch()} />}
      <Paper withBorder>
        <Table.ScrollContainer minWidth={980}>
          <Table striped highlightOnHover verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Usuário</Table.Th>
                <Table.Th>Nome</Table.Th>
                <Table.Th>E-mail</Table.Th>
                <Table.Th>Papéis</Table.Th>
                <Table.Th>Clientes</Table.Th>
                <Table.Th>Situação</Table.Th>
                <Table.Th>Último acesso</Table.Th>
                <Table.Th w={60}>
                  <span className="mantine-visually-hidden">Ações</span>
                </Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {users.isPending && <LoadingRows columns={COLUMNS} />}
              {users.isSuccess && rows.length === 0 && (
                <EmptyRow columns={COLUMNS} message={debouncedSearch ? 'Nenhum usuário encontrado para a busca.' : 'Nenhum usuário cadastrado.'} />
              )}
              {rows.map((user) => (
                <Table.Tr key={user.id}>
                  <Table.Td fw={500}>{user.username}</Table.Td>
                  <Table.Td>{user.fullName}</Table.Td>
                  <Table.Td>{user.email}</Table.Td>
                  <Table.Td>
                    <Group gap={4}>
                      {user.roles.length === 0 && <Text size="sm" c="dimmed">Nenhum</Text>}
                      {user.roles.map((r) => (
                        <Badge key={r.id} variant="light" size="sm">
                          {r.name}
                        </Badge>
                      ))}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <UserClients user={user} />
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4}>
                      <Badge color={user.isActive ? 'teal' : 'gray'} variant="dot" size="sm">
                        {user.isActive ? 'Ativo' : 'Inativo'}
                      </Badge>
                      {user.invitePending && (
                        <Badge color="blue" variant="light" size="sm">
                          Convite pendente
                        </Badge>
                      )}
                      {!user.twoFactorEnabled && !user.invitePending && (
                        <Badge color="yellow" variant="light" size="sm">
                          Sem 2FA
                        </Badge>
                      )}
                      {user.ssoLogins && user.ssoLogins.length > 0 && (
                        <Badge color="indigo" variant="light" size="sm">
                          SSO
                        </Badge>
                      )}
                      {user.hasPassword === false && (
                        <Badge color="gray" variant="light" size="sm">
                          Sem senha local
                        </Badge>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>{formatDateTime(user.lastLoginAt)}</Table.Td>
                  <Table.Td>
                    {canManage && (
                      <Menu position="bottom-end" withinPortal>
                        <Menu.Target>
                          <ActionIcon variant="subtle" color="gray" aria-label={`Ações para ${user.username}`}>
                            <IconDots size={16} />
                          </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown>
                          <Menu.Item leftSection={<IconPencil size={16} />} onClick={() => setFormState({ opened: true, user })}>
                            Editar
                          </Menu.Item>
                          {user.invitePending && (
                            <Menu.Item
                              leftSection={<IconMailForward size={16} />}
                              disabled={!user.isActive}
                              onClick={() => resendInvite.mutate(user)}
                            >
                              Reenviar convite
                            </Menu.Item>
                          )}
                          <Menu.Item leftSection={<IconKey size={16} />} onClick={() => setResetPasswordUser(user)}>
                            Redefinir senha
                          </Menu.Item>
                          <Menu.Item
                            leftSection={<IconShieldOff size={16} />}
                            disabled={!user.twoFactorEnabled}
                            onClick={() =>
                              confirmAction({
                                title: 'Redefinir verificação em duas etapas',
                                message: `${user.username} perderá o aplicativo autenticador e os códigos de recuperação atuais e terá de configurar a verificação em duas etapas no próximo acesso.`,
                                confirmLabel: 'Redefinir 2FA',
                                danger: true,
                                onConfirm: () => reset2fa.mutate(user),
                              })
                            }
                          >
                            Redefinir 2FA
                          </Menu.Item>
                          <Menu.Divider />
                          <Menu.Item
                            color="red"
                            leftSection={<IconTrash size={16} />}
                            disabled={user.id === me?.id}
                            onClick={() =>
                              confirmAction({
                                title: 'Excluir usuário',
                                message: `Excluir o usuário ${user.username}? Esta ação não pode ser desfeita.`,
                                confirmLabel: 'Excluir',
                                danger: true,
                                onConfirm: () => remove.mutate(user),
                              })
                            }
                          >
                            Excluir
                          </Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
      {users.data && (
        <Group justify="space-between" mt="md">
          <Text size="sm" c="dimmed">
            {users.data.total} {users.data.total === 1 ? 'usuário' : 'usuários'}
          </Text>
          <Pagination
            total={totalPages(users.data.total, PAGE_SIZE)}
            value={page}
            onChange={setPage}
            size="sm"
            getControlProps={(control) => ({
              'aria-label': control === 'previous' ? 'Página anterior' : control === 'next' ? 'Próxima página' : undefined,
            })}
          />
        </Group>
      )}
      <UserFormModal opened={formState.opened} user={formState.user} onClose={() => setFormState({ opened: false, user: null })} />
      <ResetPasswordModal user={resetPasswordUser} onClose={() => setResetPasswordUser(null)} />
    </>
  );
}

const CLIENTS_SHOWN = 2;

function UserClients({ user }: { user: UserDto }) {
  if (user.allClients) {
    return (
      <Text size="sm" c="dimmed">
        Todos
      </Text>
    );
  }
  const extra = user.clients.slice(CLIENTS_SHOWN);
  return (
    <Group gap={4}>
      {user.clients.slice(0, CLIENTS_SHOWN).map((c) => (
        <Badge key={c.id} variant="outline" size="sm">
          {c.name}
        </Badge>
      ))}
      {extra.length > 0 && (
        <Tooltip label={extra.map((c) => c.name).join(', ')} withArrow multiline maw={320}>
          <Badge variant="outline" color="gray" size="sm">
            +{extra.length}
          </Badge>
        </Tooltip>
      )}
    </Group>
  );
}
