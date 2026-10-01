import { Button, Group, Modal, PasswordInput, Stack, Text } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useMutation } from '@tanstack/react-query';
import { usersApi } from '../../api/users';
import type { UserDto } from '../../api/types';
import { notifySuccess } from '../../lib/feedback';
import { applyServerErrors } from '../../lib/forms';

interface ResetPasswordModalProps {
  user: UserDto | null;
  onClose: () => void;
}

export function ResetPasswordModal({ user, onClose }: ResetPasswordModalProps) {
  return (
    <Modal opened={user !== null} onClose={onClose} title="Redefinir senha" centered>
      {user && <ResetPasswordForm key={user.id} user={user} onDone={onClose} />}
    </Modal>
  );
}

function ResetPasswordForm({ user, onDone }: { user: UserDto; onDone: () => void }) {
  const form = useForm({
    initialValues: { newPassword: '', confirmPassword: '' },
    validate: {
      newPassword: (v) => (v ? null : 'Informe a nova senha'),
      confirmPassword: (v, values) => (v === values.newPassword ? null : 'As senhas não conferem'),
    },
  });
  const reset = useMutation({
    mutationFn: (newPassword: string) => usersApi.resetPassword(user.id, { newPassword }),
    onSuccess: () => {
      notifySuccess(`Senha de ${user.username} redefinida.`);
      onDone();
    },
    onError: (error) => applyServerErrors(form, error),
  });

  return (
    <form onSubmit={form.onSubmit(({ newPassword }) => reset.mutate(newPassword))} noValidate>
      <Stack>
        <Text size="sm">
          Defina uma nova senha para <strong>{user.username}</strong>.
        </Text>
        <PasswordInput label="Nova senha" required autoComplete="new-password" data-autofocus {...form.getInputProps('newPassword')} />
        <PasswordInput label="Confirmar nova senha" required autoComplete="new-password" {...form.getInputProps('confirmPassword')} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onDone}>
            Cancelar
          </Button>
          <Button type="submit" loading={reset.isPending}>
            Redefinir senha
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
