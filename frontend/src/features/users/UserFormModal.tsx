import { Alert, Button, Group, Modal, MultiSelect, PasswordInput, SegmentedControl, Stack, Switch, Text, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rolesApi } from '../../api/roles';
import { usersApi } from '../../api/users';
import type { UserDto } from '../../api/types';
import { notifySuccess } from '../../lib/feedback';
import { applyServerErrors } from '../../lib/forms';
import { UserSsoLogins } from './UserSsoLogins';

interface UserFormModalProps {
  opened: boolean;
  user: UserDto | null;
  onClose: () => void;
}

export function UserFormModal({ opened, user, onClose }: UserFormModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} title={user ? 'Editar usuário' : 'Novo usuário'} centered size="lg">
      {opened && <UserForm key={user?.id ?? 'new'} user={user} onDone={onClose} />}
    </Modal>
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type PasswordMode = 'invite' | 'password';

function UserForm({ user, onDone }: { user: UserDto | null; onDone: () => void }) {
  const queryClient = useQueryClient();
  const isEdit = user !== null;
  const roles = useQuery({ queryKey: ['roles', 'options'], queryFn: () => rolesApi.options() });

  const form = useForm({
    initialValues: {
      username: user?.username ?? '',
      email: user?.email ?? '',
      fullName: user?.fullName ?? '',
      password: '',
      passwordMode: 'invite' as PasswordMode,
      roleIds: user?.roles.map((r) => r.id) ?? [],
      isActive: user?.isActive ?? true,
    },
    validate: {
      username: (v) => (isEdit || v.trim() ? null : 'Informe o nome de usuário'),
      email: (v) => (EMAIL_RE.test(v.trim()) ? null : 'Informe um e-mail válido'),
      fullName: (v) => (v.trim() ? null : 'Informe o nome completo'),
      password: (v, values) => (isEdit || values.passwordMode === 'invite' || v ? null : 'Informe a senha inicial'),
    },
  });

  const save = useMutation({
    mutationFn: (values: typeof form.values) => {
      const common = {
        email: values.email.trim(),
        fullName: values.fullName.trim(),
        roleIds: values.roleIds,
        isActive: values.isActive,
      };
      if (isEdit) return usersApi.update(user.id, common);
      const username = values.username.trim();
      return values.passwordMode === 'invite'
        ? usersApi.create({ ...common, username, sendInvite: true })
        : usersApi.create({ ...common, username, password: values.password });
    },
    onSuccess: async (saved) => {
      if (saved.inviteError) {
        notifications.show({
          color: 'yellow',
          title: 'Usuário criado, mas o convite não foi enviado',
          message: `${saved.inviteError}. Corrija o SMTP em Configurações e use "Reenviar convite".`,
          autoClose: false,
        });
      } else if (!isEdit && saved.invitePending) {
        notifySuccess(`Usuário criado. Convite enviado para ${saved.email}.`);
      } else {
        notifySuccess(isEdit ? 'Usuário atualizado.' : 'Usuário criado.');
      }
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      onDone();
    },
    onError: (error) => applyServerErrors(form, error),
  });

  // Mantem visiveis os papeis atuais mesmo se a lista completa nao puder ser carregada.
  const roleOptions = roles.data
    ? roles.data.map((r) => ({ value: r.id, label: r.name }))
    : (user?.roles.map((r) => ({ value: r.id, label: r.name })) ?? []);

  return (
    <form onSubmit={form.onSubmit((values) => save.mutate(values))} noValidate>
      <Stack>
        <TextInput
          label="Usuário"
          required={!isEdit}
          disabled={isEdit}
          autoComplete="off"
          data-autofocus={!isEdit || undefined}
          {...form.getInputProps('username')}
        />
        <TextInput label="Nome completo" required {...form.getInputProps('fullName')} />
        <TextInput label="E-mail" type="email" required {...form.getInputProps('email')} />
        {!isEdit && (
          <Stack gap={6}>
            <Text size="sm" fw={500}>
              Acesso inicial
            </Text>
            <SegmentedControl
              data={[
                { value: 'invite', label: 'Enviar convite por e-mail' },
                { value: 'password', label: 'Definir senha agora' },
              ]}
              {...form.getInputProps('passwordMode')}
            />
            {form.values.passwordMode === 'invite' ? (
              <>
                <Text size="xs" c="dimmed">
                  O usuário recebe um link, válido por 72 horas, para criar a própria senha.
                </Text>
                {form.errors.sendInvite && (
                  <Alert color="red" variant="light">
                    {form.errors.sendInvite}
                  </Alert>
                )}
              </>
            ) : (
              <PasswordInput label="Senha inicial" required autoComplete="new-password" {...form.getInputProps('password')} />
            )}
          </Stack>
        )}
        {roles.isError && (
          <Alert color="yellow" variant="light">
            Não foi possível carregar a lista de papéis.
          </Alert>
        )}
        <MultiSelect
          label="Papéis"
          placeholder="Selecione os papéis"
          data={roleOptions}
          searchable
          clearable
          nothingFoundMessage="Nenhum papel encontrado"
          disabled={roles.isPending}
          {...form.getInputProps('roleIds')}
        />
        <Switch label="Usuário ativo" {...form.getInputProps('isActive', { type: 'checkbox' })} />
        {isEdit && <UserSsoLogins user={user} canManage />}
        <Group justify="flex-end" mt="sm">
          <Button variant="default" onClick={onDone}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            {isEdit ? 'Salvar' : 'Criar usuário'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
