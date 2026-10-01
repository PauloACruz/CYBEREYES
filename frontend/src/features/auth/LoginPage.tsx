import { Button, Checkbox, PasswordInput, Stack, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { authApi } from '../../api/auth';
import type { LoginRequest } from '../../api/types';
import { PATHS } from '../../app/paths';
import { ME_QUERY_KEY } from '../../auth/useMe';
import { applyServerErrors } from '../../lib/forms';
import { AuthLayout } from './AuthLayout';

export interface TwoFactorLocationState {
  rememberMe: boolean;
}

export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const form = useForm<Required<LoginRequest>>({
    initialValues: { username: '', password: '', rememberMe: false },
    validate: {
      username: (v) => (v.trim() ? null : 'Informe o usuário'),
      password: (v) => (v ? null : 'Informe a senha'),
    },
  });

  const login = useMutation({
    mutationFn: authApi.login,
    onSuccess: async ({ status }, variables) => {
      queryClient.removeQueries({ queryKey: ME_QUERY_KEY });
      switch (status) {
        case 'ok':
          await navigate(PATHS.dashboard, { replace: true });
          break;
        case 'requires2fa': {
          const state: TwoFactorLocationState = { rememberMe: variables.rememberMe ?? false };
          await navigate(PATHS.loginTwoFactor, { state });
          break;
        }
        case 'requires2faSetup':
          await navigate(PATHS.twoFactorSetup, { replace: true });
          break;
      }
    },
    onError: (error) => {
      applyServerErrors(form, error);
      form.setFieldValue('password', '');
    },
  });

  return (
    <AuthLayout title="Entrar" subtitle="Acesse o console com seu usuário e senha.">
      <form onSubmit={form.onSubmit((values) => login.mutate({ ...values, username: values.username.trim() }))} noValidate>
        <Stack>
          <TextInput
            label="Usuário"
            autoComplete="username"
            autoFocus
            required
            {...form.getInputProps('username')}
          />
          <PasswordInput label="Senha" autoComplete="current-password" required {...form.getInputProps('password')} />
          <Checkbox label="Manter conectado neste dispositivo" {...form.getInputProps('rememberMe', { type: 'checkbox' })} />
          <Button type="submit" fullWidth loading={login.isPending}>
            Entrar
          </Button>
        </Stack>
      </form>
    </AuthLayout>
  );
}
