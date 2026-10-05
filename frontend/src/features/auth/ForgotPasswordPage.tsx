import { Alert, Anchor, Button, Stack, Text, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useMutation } from '@tanstack/react-query';
import { Link } from 'react-router';
import { authApi } from '../../api/auth';
import { PATHS } from '../../app/paths';
import { AuthLayout } from './AuthLayout';

export function ForgotPasswordPage() {
  const form = useForm({
    initialValues: { login: '' },
    validate: { login: (v) => (v.trim() ? null : 'Informe o usuário ou o e-mail') },
  });
  const forgot = useMutation({ mutationFn: authApi.forgotPassword });

  if (forgot.isSuccess) {
    return (
      <AuthLayout title="Verifique seu e-mail">
        <Stack>
          <Text size="sm">
            Se existir uma conta ativa com esse usuário ou e-mail, enviamos um link para criar uma nova senha. O link vale por 2 horas e
            funciona uma única vez.
          </Text>
          <Text size="sm" c="dimmed">
            Não chegou em alguns minutos? Confira a caixa de spam ou fale com o administrador do console.
          </Text>
          <Button component={Link} to={PATHS.login} fullWidth>
            Voltar ao login
          </Button>
        </Stack>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Esqueci minha senha" subtitle="Informe seu usuário ou e-mail e enviaremos um link para criar uma nova senha.">
      <form onSubmit={form.onSubmit(({ login }) => forgot.mutate({ login: login.trim() }))} noValidate>
        <Stack>
          {forgot.isError && (
            <Alert color="red" variant="light">
              Não foi possível enviar o pedido. Tente novamente em instantes.
            </Alert>
          )}
          <TextInput label="Usuário ou e-mail" autoComplete="username" autoFocus required {...form.getInputProps('login')} />
          <Button type="submit" fullWidth loading={forgot.isPending}>
            Enviar link
          </Button>
          <Anchor component={Link} to={PATHS.login} size="sm" ta="center">
            Voltar ao login
          </Anchor>
        </Stack>
      </form>
    </AuthLayout>
  );
}
