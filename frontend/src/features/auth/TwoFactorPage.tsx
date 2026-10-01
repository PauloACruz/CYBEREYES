import { useState } from 'react';
import { Anchor, Button, Center, Group, PinInput, Stack, Text, TextInput } from '@mantine/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router';
import { authApi } from '../../api/auth';
import { PATHS } from '../../app/paths';
import { ME_QUERY_KEY } from '../../auth/useMe';
import { AuthLayout } from './AuthLayout';
import type { TwoFactorLocationState } from './LoginPage';

type Mode = 'totp' | 'recovery';

function readRememberMe(state: unknown): boolean {
  if (state && typeof state === 'object' && 'rememberMe' in state) {
    return (state as TwoFactorLocationState).rememberMe;
  }
  return false;
}

export function TwoFactorPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const rememberMe = readRememberMe(location.state);
  const [mode, setMode] = useState<Mode>('totp');
  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');

  const onSuccess = async () => {
    queryClient.removeQueries({ queryKey: ME_QUERY_KEY });
    await navigate(PATHS.dashboard, { replace: true });
  };

  const verifyTotp = useMutation({
    mutationFn: authApi.loginTwoFactor,
    onSuccess,
    onError: () => setCode(''),
  });
  const verifyRecovery = useMutation({ mutationFn: authApi.loginRecovery, onSuccess });

  const submitTotp = (value: string) => {
    if (value.length === 6 && !verifyTotp.isPending) verifyTotp.mutate({ code: value, rememberMe });
  };

  if (mode === 'recovery') {
    return (
      <AuthLayout
        title="Código de recuperação"
        subtitle="Digite um dos códigos de recuperação que você guardou ao configurar a verificação em duas etapas. Cada código funciona uma única vez."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (recoveryCode.trim()) verifyRecovery.mutate({ recoveryCode: recoveryCode.trim() });
          }}
        >
          <Stack>
            <TextInput
              label="Código de recuperação"
              autoComplete="one-time-code"
              autoFocus
              required
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.currentTarget.value)}
            />
            <Button type="submit" fullWidth loading={verifyRecovery.isPending} disabled={!recoveryCode.trim()}>
              Verificar
            </Button>
            <Group justify="space-between">
              <Anchor component="button" type="button" size="sm" onClick={() => setMode('totp')}>
                Usar código do aplicativo
              </Anchor>
              <Anchor component={Link} to={PATHS.login} size="sm">
                Voltar ao login
              </Anchor>
            </Group>
          </Stack>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Verificação em duas etapas"
      subtitle="Digite o código de 6 dígitos exibido no seu aplicativo autenticador."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitTotp(code);
        }}
      >
        <Stack>
          <Center>
            <PinInput
              length={6}
              type="number"
              oneTimeCode
              autoFocus
              value={code}
              onChange={setCode}
              onComplete={submitTotp}
              aria-label="Código de verificação"
              disabled={verifyTotp.isPending}
            />
          </Center>
          <Button type="submit" fullWidth loading={verifyTotp.isPending} disabled={code.length !== 6}>
            Verificar
          </Button>
          <Group justify="space-between">
            <Anchor component="button" type="button" size="sm" onClick={() => setMode('recovery')}>
              Usar código de recuperação
            </Anchor>
            <Anchor component={Link} to={PATHS.login} size="sm">
              Voltar ao login
            </Anchor>
          </Group>
          <Text size="xs" c="dimmed" ta="center">
            Perdeu o acesso ao aplicativo e aos códigos? Peça a um administrador para redefinir sua verificação em duas etapas.
          </Text>
        </Stack>
      </form>
    </AuthLayout>
  );
}
