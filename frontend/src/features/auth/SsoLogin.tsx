import { Alert, Anchor, Button, Divider, Stack } from '@mantine/core';
import { IconAlertCircle, IconLogin2 } from '@tabler/icons-react';
import { Navigate } from 'react-router';
import { ssoStartUrl } from '../../api/sso';
import type { SsoProviderOption } from '../../api/types';
import { PATHS } from '../../app/paths';
import type { TwoFactorLocationState } from './LoginPage';
import { returnPathFromState } from './ssoMessages';

/** Retorno do callback do SSO com sessao parcial: segue o mesmo fluxo do login por senha. */
export function SsoReturnRedirect({ step }: { step: '2fa' | 'setup' }) {
  if (step === '2fa') {
    const state: TwoFactorLocationState = { rememberMe: false };
    return <Navigate to={PATHS.loginTwoFactor} replace state={state} />;
  }
  return <Navigate to={PATHS.twoFactorSetup} replace />;
}

export function SsoErrorAlert({ message }: { message: string }) {
  return (
    <Alert color="red" variant="light" icon={<IconAlertCircle size={18} />} title="Não foi possível entrar" role="alert">
      {message}
    </Alert>
  );
}

interface SsoLoginOptionsProps {
  providers: SsoProviderOption[];
  /** location.state da tela de login (caminho de origem). */
  from: unknown;
  passwordHidden: boolean;
  showDivider: boolean;
  onShowPassword: () => void;
}

export function SsoLoginOptions({ providers, from, passwordHidden, showDivider, onShowPassword }: SsoLoginOptionsProps) {
  const returnUrl = returnPathFromState(from);
  return (
    <>
      {providers.length > 0 && (
        <Stack gap="xs">
          {providers.map((provider, index) => (
            <Button
              key={provider.id}
              component="a"
              href={ssoStartUrl(provider.id, returnUrl)}
              variant={passwordHidden ? 'filled' : 'default'}
              leftSection={<IconLogin2 size={16} />}
              fullWidth
              autoFocus={passwordHidden && index === 0}
            >
              Entrar com {provider.name}
            </Button>
          ))}
        </Stack>
      )}
      {showDivider && <Divider label="ou" labelPosition="center" />}
      {passwordHidden && (
        <Anchor component="button" type="button" size="xs" c="dimmed" ta="center" onClick={onShowPassword}>
          Entrar com senha (administrador)
        </Anchor>
      )}
    </>
  );
}
