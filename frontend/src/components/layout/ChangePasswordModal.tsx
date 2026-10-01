import { Button, Group, Modal, PasswordInput, Stack } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useMutation } from '@tanstack/react-query';
import { authApi } from '../../api/auth';
import { notifySuccess } from '../../lib/feedback';
import { applyServerErrors } from '../../lib/forms';

interface ChangePasswordModalProps {
  opened: boolean;
  onClose: () => void;
}

export function ChangePasswordModal({ opened, onClose }: ChangePasswordModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} title="Trocar senha" centered>
      {opened && <ChangePasswordForm onDone={onClose} />}
    </Modal>
  );
}

function ChangePasswordForm({ onDone }: { onDone: () => void }) {
  const form = useForm({
    initialValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
    validate: {
      currentPassword: (v) => (v ? null : 'Informe a senha atual'),
      newPassword: (v, values) => {
        if (!v) return 'Informe a nova senha';
        if (v === values.currentPassword) return 'A nova senha deve ser diferente da atual';
        return null;
      },
      confirmPassword: (v, values) => (v === values.newPassword ? null : 'As senhas não conferem'),
    },
  });

  const change = useMutation({
    mutationFn: authApi.changePassword,
    onSuccess: () => {
      notifySuccess('Sua senha foi alterada.');
      onDone();
    },
    onError: (error) => applyServerErrors(form, error),
  });

  return (
    <form
      onSubmit={form.onSubmit(({ currentPassword, newPassword }) => change.mutate({ currentPassword, newPassword }))}
      noValidate
    >
      <Stack>
        <PasswordInput label="Senha atual" autoComplete="current-password" required data-autofocus {...form.getInputProps('currentPassword')} />
        <PasswordInput label="Nova senha" autoComplete="new-password" required {...form.getInputProps('newPassword')} />
        <PasswordInput label="Confirmar nova senha" autoComplete="new-password" required {...form.getInputProps('confirmPassword')} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onDone}>
            Cancelar
          </Button>
          <Button type="submit" loading={change.isPending}>
            Salvar
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
