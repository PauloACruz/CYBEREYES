import { Alert, Anchor, Button, PasswordInput, Stack, Text } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useMutation } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { authApi } from '../../api/auth';
import { ApiError } from '../../api/client';
import { PATHS } from '../../app/paths';
import { applyServerErrors } from '../../lib/forms';
import { AuthLayout } from './AuthLayout';

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const userId = searchParams.get('uid') ?? '';
  const token = searchParams.get('token') ?? '';
  const form = useForm({
    initialValues: { newPassword: '', confirmPassword: '' },
    validate: {
      newPassword: (v) => (v ? null : 'Informe a nova senha'),
      confirmPassword: (v, values) => (v === values.newPassword ? null : 'As senhas não conferem'),
    },
  });
  const reset = useMutation({
    mutationFn: authApi.resetPasswordWithToken,
    onError: (error) => applyServerErrors(form, error),
  });

  if (!userId || !token) {
    return <InvalidLink message="O link está incompleto. Copie o endereço inteiro do e-mail ou peça um novo link." />;
  }
  if (reset.error instanceof ApiError && reset.error.code === 'INVALID_TOKEN') {
    return <InvalidLink message="Este link é inválido, expirou ou já foi usado. Peça um novo link." />;
  }

  if (reset.isSuccess) {
    return (
      <AuthLayout title="Senha redefinida">
        <Stack>
          <Text size="sm">Sua nova senha já vale. Entre com ela; a verificação em duas etapas continua sendo pedida.</Text>
          <Button component={Link} to={PATHS.login} fullWidth>
            Ir para o login
          </Button>
        </Stack>
      </AuthLayout>
    );
  }

  const otherError = reset.error instanceof ApiError && reset.error.status !== 400 ? reset.error : null;
  return (
    <AuthLayout title="Nova senha" subtitle="Crie uma senha com pelo menos 12 caracteres.">
      <form onSubmit={form.onSubmit(({ newPassword }) => reset.mutate({ userId, token, newPassword }))} noValidate>
        <Stack>
          {otherError && (
            <Alert color="red" variant="light">
              {otherError.title}
            </Alert>
          )}
          <PasswordInput label="Nova senha" autoComplete="new-password" autoFocus required {...form.getInputProps('newPassword')} />
          <PasswordInput label="Confirmar nova senha" autoComplete="new-password" required {...form.getInputProps('confirmPassword')} />
          <Button type="submit" fullWidth loading={reset.isPending}>
            Salvar nova senha
          </Button>
        </Stack>
      </form>
    </AuthLayout>
  );
}

function InvalidLink({ message }: { message: string }) {
  return (
    <AuthLayout title="Link inválido">
      <Stack>
        <Alert color="yellow" variant="light">
          {message}
        </Alert>
        <Button component={Link} to={PATHS.forgotPassword} fullWidth>
          Pedir novo link
        </Button>
        <Anchor component={Link} to={PATHS.login} size="sm" ta="center">
          Voltar ao login
        </Anchor>
      </Stack>
    </AuthLayout>
  );
}
