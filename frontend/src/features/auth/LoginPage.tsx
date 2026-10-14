import { useState } from 'react';
import { Anchor, Button, Checkbox, Divider, Group, PasswordInput, Stack, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { IconFingerprint } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { authApi } from '../../api/auth';
import { ApiError } from '../../api/client';
import type { LoginRequest, LoginStatus } from '../../api/types';
import { PATHS } from '../../app/paths';
import { takeReturnPath } from '../../auth/returnPath';
import { isAppLogin } from '../mobile/mobileMode';
import { ME_QUERY_KEY } from '../../auth/useMe';
import { applyServerErrors } from '../../lib/forms';
import { AuthLayout } from './AuthLayout';
import { SsoErrorAlert, SsoLoginOptions, SsoReturnRedirect } from './SsoLogin';
import { ssoErrorMessage, useSsoLoginOptions } from './ssoMessages';
import { devicePasskeyId, isBiometricsCancelled, signInWithPasskey, webAuthnSupported } from './webauthn';

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

  const proceed = async (status: LoginStatus, rememberMe: boolean) => {
    queryClient.removeQueries({ queryKey: ME_QUERY_KEY });
    switch (status) {
      case 'ok':
        await navigate(takeReturnPath(), { replace: true });
        break;
      case 'requires2fa': {
        const state: TwoFactorLocationState = { rememberMe };
        await navigate(PATHS.loginTwoFactor, { state });
        break;
      }
      case 'requires2faSetup':
        await navigate(PATHS.twoFactorSetup, { replace: true });
        break;
    }
  };

  const login = useMutation({
    mutationFn: authApi.login,
    onSuccess: ({ status }, variables) => proceed(status, variables.rememberMe ?? false),
    onError: (error) => {
      applyServerErrors(form, error);
      form.setFieldValue('password', '');
    },
  });

  // Biometria no lugar da senha; o codigo do autenticador ainda e pedido se o aparelho nao foi lembrado nos ultimos 30 dias.
  const biometrics = useMutation({
    mutationFn: signInWithPasskey,
    onSuccess: ({ status }, rememberMe) => proceed(status, rememberMe),
    onError: (error) => {
      if (isBiometricsCancelled(error) || error instanceof ApiError) return; // erro da API ja aparece na notificacao
      notifications.show({ color: 'red', title: 'Biometria indisponível', message: 'Entre com usuário e senha.' });
    },
  });

  const ssoStep = searchParams.get('sso');
  if (ssoStep === '2fa' || ssoStep === 'setup') return <SsoReturnRedirect step={ssoStep} />;

  const ssoError = searchParams.get('ssoError');
  const navigationState: unknown = location.state;
  const providers = sso.data?.providers ?? [];
  // Enquanto a lista carrega (ou se falhar) o formulario fica visivel: o login por senha e o caminho padrao.
  const passwordHidden = sso.data?.passwordLoginEnabled === false && !showPassword;
  const app = isAppLogin();
  const subtitle = app
    ? undefined
    : passwordHidden
      ? 'Acesse o console com a conta da sua organização.'
      : 'Acesse o console com seu usuário e senha.';
  const forgot = (
    <Anchor component={Link} to={PATHS.forgotPassword} size="sm" ta={app ? 'center' : undefined}>
      Esqueci minha senha
    </Anchor>
  );

  const biometricsButton = devicePasskeyId() !== null && webAuthnSupported() && (
    <>
      <Button
        variant="light"
        fullWidth
        size={app ? 'md' : undefined}
        leftSection={<IconFingerprint size={20} />}
        loading={biometrics.isPending}
        onClick={() => biometrics.mutate(form.values.rememberMe)}
      >
        Entrar com biometria
      </Button>
      <Divider label="ou com usuário e senha" labelPosition="center" />
    </>
  );

  const passwordForm = (
    <form onSubmit={form.onSubmit((values) => login.mutate({ ...values, username: values.username.trim() }))} noValidate>
      <Stack>
        <TextInput
          label="Usuário ou e-mail"
          autoComplete="username"
          autoFocus={providers.length === 0 || showPassword}
          required
          {...form.getInputProps('username')}
        />
        <PasswordInput label="Senha" autoComplete="current-password" required {...form.getInputProps('password')} />
        {app ? (
          <Checkbox label="Manter conectado neste celular" {...form.getInputProps('rememberMe', { type: 'checkbox' })} />
        ) : (
          <Group justify="space-between" wrap="nowrap">
            <Checkbox label="Manter conectado neste dispositivo" {...form.getInputProps('rememberMe', { type: 'checkbox' })} />
            {forgot}
          </Group>
        )}
        <Button type="submit" fullWidth loading={login.isPending} size={app ? 'md' : undefined}>
          Entrar
        </Button>
        {app && forgot}
      </Stack>
    </form>
  );

  return (
    <AuthLayout
      title="Entrar"
      subtitle={subtitle}
      footer={
        app
          ? 'Depois da senha ou da biometria, o app pede o código do autenticador; neste celular ele pode ficar dispensado por 30 dias.'
          : undefined
      }
    >
      <Stack>
        {ssoError !== null && <SsoErrorAlert message={ssoErrorMessage(ssoError)} />}
        <SsoLoginOptions
          providers={providers}
          from={navigationState}
          passwordHidden={passwordHidden}
          showDivider={providers.length > 0 && !passwordHidden}
          onShowPassword={() => setShowPassword(true)}
        />
        {!passwordHidden && biometricsButton}
        {!passwordHidden && passwordForm}
      </Stack>
    </AuthLayout>
  );
}
