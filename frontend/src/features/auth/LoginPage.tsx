import { useState } from 'react';
import { Button, Checkbox, PasswordInput, Stack, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { authApi } from '../../api/auth';
import type { LoginRequest } from '../../api/types';
import { PATHS } from '../../app/paths';
import { ME_QUERY_KEY } from '../../auth/useMe';
import { applyServerErrors } from '../../lib/forms';
import { AuthLayout } from './AuthLayout';
import { SsoErrorAlert, SsoLoginOptions, SsoReturnRedirect } from './SsoLogin';
import { ssoErrorMessage, useSsoLoginOptions } from './ssoMessages';

export interface TwoFactorLocationState {
  rememberMe: boolean;
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const sso = useSsoLoginOptions();
  const [showPassword, setShowPassword] = useState(false);
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

  const ssoStep = searchParams.get('sso');
  if (ssoStep === '2fa' || ssoStep === 'setup') return <SsoReturnRedirect step={ssoStep} />;

  const ssoError = searchParams.get('ssoError');
  const navigationState: unknown = location.state;
  const providers = sso.data?.providers ?? [];
  // Enquanto a lista carrega (ou se falhar) o formulario fica visivel: o login por senha e o caminho padrao.
  const passwordHidden = sso.data?.passwordLoginEnabled === false && !showPassword;
  const subtitle = passwordHidden ? 'Acesse o console com a conta da sua organização.' : 'Acesse o console com seu usuário e senha.';

  const passwordForm = (
    <form onSubmit={form.onSubmit((values) => login.mutate({ ...values, username: values.username.trim() }))} noValidate>
      <Stack>
        <TextInput
          label="Usuário"
          autoComplete="username"
          autoFocus={providers.length === 0 || showPassword}
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
  );

  return (
    <AuthLayout title="Entrar" subtitle={subtitle}>
      <Stack>
        {ssoError !== null && <SsoErrorAlert message={ssoErrorMessage(ssoError)} />}
        <SsoLoginOptions
          providers={providers}
          from={navigationState}
          passwordHidden={passwordHidden}
          showDivider={providers.length > 0 && !passwordHidden}
          onShowPassword={() => setShowPassword(true)}
        />
        {!passwordHidden && passwordForm}
      </Stack>
    </AuthLayout>
  );
}
