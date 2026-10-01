import { Alert, Button, Group, Modal, MultiSelect, PasswordInput, Stack, Switch, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rolesApi } from '../../api/roles';
import { usersApi } from '../../api/users';
import type { UserDto } from '../../api/types';
import { notifySuccess } from '../../lib/feedback';
import { applyServerErrors } from '../../lib/forms';

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
      roleIds: user?.roles.map((r) => r.id) ?? [],
      isActive: user?.isActive ?? true,
    },
    validate: {
      username: (v) => (isEdit || v.trim() ? null : 'Informe o nome de usuário'),
      email: (v) => (EMAIL_RE.test(v.trim()) ? null : 'Informe um e-mail válido'),
      fullName: (v) => (v.trim() ? null : 'Informe o nome completo'),
      password: (v) => (isEdit || v ? null : 'Informe a senha inicial'),
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
      return isEdit
        ? usersApi.update(user.id, common)
        : usersApi.create({ ...common, username: values.username.trim(), password: values.password });
    },
    onSuccess: async () => {
      notifySuccess(isEdit ? 'Usuário atualizado.' : 'Usuário criado.');
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
          <PasswordInput label="Senha inicial" required autoComplete="new-password" {...form.getInputProps('password')} />
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
