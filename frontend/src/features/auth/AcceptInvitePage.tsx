import { Alert, Anchor, Button, Center, Loader, PasswordInput, Stack, Text } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { authApi } from '../../api/auth';
import { ApiError } from '../../api/client';
import { PATHS } from '../../app/paths';
import { applyServerErrors } from '../../lib/forms';
import { AuthLayout } from './AuthLayout';

export function AcceptInvitePage() {
  const [searchParams] = useSearchParams();
  const userId = searchParams.get('uid') ?? '';
  const token = searchParams.get('token') ?? '';
  const invite = useQuery({
    queryKey: ['invite', userId, token],
    queryFn: () => authApi.inviteInfo(userId, token),
    enabled: userId !== '' && token !== '',
    retry: false,
  });
  const form = useForm({
    initialValues: { password: '', confirmPassword: '' },
    validate: {
      password: (v) => (v ? null : 'Informe a senha'),
      confirmPassword: (v, values) => (v === values.password ? null : 'As senhas não conferem'),
    },
  });
  const accept = useMutation({
    mutationFn: authApi.acceptInvite,
    onError: (error) => applyServerErrors(form, error),
  });

  if (!userId || !token) {
    return <InviteProblem message="O link está incompleto. Copie o endereço inteiro do e-mail de convite." />;
  }
  if (invite.isPending) {
    return (
      <AuthLayout title="Convite">
        <Center py="xl">
          <Loader aria-label="Verificando o convite" />
        </Center>
      </AuthLayout>
    );
  }
  const info = invite.data;
  const linkError = invite.error ?? (accept.error instanceof ApiError && accept.error.code === 'INVALID_TOKEN' ? accept.error : null);
  if (linkError || !info) {
    return (
      <InviteProblem
        message={
          linkError instanceof ApiError && linkError.code === 'INVALID_TOKEN'
            ? `${linkError.title}. Se o link expirou, peça ao administrador para reenviar o convite.`
            : 'Não foi possível verificar o convite. Tente novamente em instantes.'
        }
      />
    );
  }

  if (accept.isSuccess) {
    return (
      <AuthLayout title="Senha criada">
        <Stack>
          <Text size="sm">
            Entre com o usuário <strong>{info.username}</strong> e a senha que você acabou de criar. No primeiro acesso, o console
            pede para configurar a verificação em duas etapas (Google Authenticator, Microsoft Authenticator ou similar).
          </Text>
          <Button component={Link} to={PATHS.login} fullWidth>
            Ir para o login
          </Button>
        </Stack>
      </AuthLayout>
    );
  }

  const otherError = accept.error instanceof ApiError && accept.error.status !== 400 ? accept.error : null;
  return (
    <AuthLayout title="Bem-vindo ao Cybereyes" subtitle={`Olá, ${info.fullName}. Crie sua senha para acessar o console.`}>
      <form onSubmit={form.onSubmit(({ password }) => accept.mutate({ userId, token, password }))} noValidate>
        <Stack>
          <Text size="sm">
            Seu usuário: <strong>{info.username}</strong>
          </Text>
          {otherError && (
            <Alert color="red" variant="light">
              {otherError.title}
            </Alert>
          )}
          <PasswordInput
            label="Senha"
            description="Pelo menos 12 caracteres."
            autoComplete="new-password"
            autoFocus
            required
            {...form.getInputProps('password')}
          />
          <PasswordInput label="Confirmar senha" autoComplete="new-password" required {...form.getInputProps('confirmPassword')} />
          <Button type="submit" fullWidth loading={accept.isPending}>
            Criar senha
          </Button>
        </Stack>
      </form>
    </AuthLayout>
  );
}

function InviteProblem({ message }: { message: string }) {
  return (
    <AuthLayout title="Convite inválido">
      <Stack>
        <Alert color="yellow" variant="light">
          {message}
        </Alert>
        <Anchor component={Link} to={PATHS.login} size="sm" ta="center">
          Ir para o login
        </Anchor>
      </Stack>
    </AuthLayout>
  );
}
