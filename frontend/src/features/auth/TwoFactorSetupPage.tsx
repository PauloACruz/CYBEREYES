import { useState } from 'react';
import {
  Alert,
  Anchor,
  Button,
  Center,
  Checkbox,
  CopyButton,
  Image,
  List,
  Loader,
  PinInput,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
} from '@mantine/core';
import { IconAlertTriangle, IconCheck, IconCopy } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { Navigate, useNavigate } from 'react-router';
import { authApi } from '../../api/auth';
import { PATHS } from '../../app/paths';
import { ME_QUERY_KEY, useMe } from '../../auth/useMe';
import { CopyField } from '../../components/CopyField';
import { LoadError } from '../../components/TableStates';
import { AuthLayout } from './AuthLayout';

function groupKey(key: string): string {
  return key.replace(/\s+/g, '').match(/.{1,4}/g)?.join(' ') ?? key;
}

async function qrDataUri(otpauthUri: string): Promise<string> {
  const svg = await QRCode.toString(otpauthUri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function TwoFactorSetupPage() {
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  if (recoveryCodes) return <RecoveryCodesStep codes={recoveryCodes} />;
  return <EnableStep onEnabled={setRecoveryCodes} />;
}

function EnableStep({ onEnabled }: { onEnabled: (codes: string[]) => void }) {
  const me = useMe();
  const setup = useQuery({
    queryKey: ['auth', '2fa-setup'],
    queryFn: authApi.getTwoFactorSetup,
    enabled: me.data !== undefined && !me.data.twoFactorEnabled,
    staleTime: Infinity,
    gcTime: 0,
  });
  const otpauthUri = setup.data?.otpauthUri;
  const qr = useQuery({
    queryKey: ['auth', '2fa-qr', otpauthUri],
    queryFn: () => qrDataUri(otpauthUri ?? ''),
    enabled: otpauthUri !== undefined,
    staleTime: Infinity,
    gcTime: 0,
  });
  const [code, setCode] = useState('');
  const enable = useMutation({
    mutationFn: authApi.enableTwoFactor,
    onSuccess: (result) => onEnabled(result.recoveryCodes),
    onError: () => setCode(''),
  });

  if (me.data?.twoFactorEnabled) {
    return <Navigate to={me.data.mfaSatisfied ? PATHS.dashboard : PATHS.loginTwoFactor} replace />;
  }

  const submit = (value: string) => {
    if (value.length === 6 && !enable.isPending) enable.mutate({ code: value });
  };

  return (
    <AuthLayout
      title="Configurar verificação em duas etapas"
      subtitle="A verificação em duas etapas é obrigatória. Configure um aplicativo autenticador (Microsoft Authenticator, Google Authenticator, Authy ou similar) para continuar."
      width={520}
    >
      {me.isError || setup.isError ? (
        <LoadError
          error={me.isError ? me.error : setup.error}
          onRetry={() => void (me.isError ? me.refetch() : setup.refetch())}
        />
      ) : (
        <Stack>
          <List type="ordered" size="sm" spacing="xs">
            <List.Item>Abra o aplicativo autenticador e escaneie o QR code abaixo.</List.Item>
            <List.Item>Se não conseguir escanear, digite a chave manualmente.</List.Item>
            <List.Item>Informe o código de 6 dígitos gerado pelo aplicativo.</List.Item>
          </List>
          <Center>
            {qr.data ? (
              <Image src={qr.data} alt="QR code para configurar o aplicativo autenticador" w={200} h={200} radius="sm" bg="white" />
            ) : (
              <Skeleton w={200} h={200} />
            )}
          </Center>
          <Stack gap={4}>
            <Text size="sm" fw={500}>
              Chave manual
            </Text>
            {setup.data ? (
              <CopyField value={setup.data.sharedKey} display={groupKey(setup.data.sharedKey)} label="Copiar chave" />
            ) : (
              <Skeleton h={24} />
            )}
          </Stack>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(code);
            }}
          >
            <Stack>
              <Text size="sm" fw={500}>
                Código de verificação
              </Text>
              <Center>
                <PinInput
                  length={6}
                  type="number"
                  oneTimeCode
                  value={code}
                  onChange={setCode}
                  onComplete={submit}
                  aria-label="Código de verificação"
                  disabled={!setup.data || enable.isPending}
                />
              </Center>
              <Button type="submit" fullWidth loading={enable.isPending} disabled={code.length !== 6 || !setup.data}>
                Ativar verificação em duas etapas
              </Button>
            </Stack>
          </form>
          <LogoutLink />
        </Stack>
      )}
    </AuthLayout>
  );
}

function RecoveryCodesStep({ codes }: { codes: string[] }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);

  const finish = async () => {
    queryClient.removeQueries({ queryKey: ME_QUERY_KEY });
    await navigate(PATHS.dashboard, { replace: true });
  };

  return (
    <AuthLayout title="Códigos de recuperação" width={520}>
      <Stack>
        <Alert color="yellow" icon={<IconAlertTriangle size={18} />} title="Guarde estes códigos agora">
          Eles não serão exibidos novamente. Use um deles para entrar caso perca o acesso ao aplicativo autenticador. Cada código funciona uma única vez.
        </Alert>
        <SimpleGrid cols={2} spacing="xs" component="ul" p={0} m={0} style={{ listStyle: 'none' }} aria-label="Códigos de recuperação">
          {codes.map((c) => (
            <Text component="li" key={c} ff="monospace" ta="center" p={6} bd="1px solid var(--mantine-color-default-border)" style={{ borderRadius: 4 }}>
              {c}
            </Text>
          ))}
        </SimpleGrid>
        <CopyButton value={codes.join('\n')}>
          {({ copied, copy }) => (
            <Button
              variant="light"
              color={copied ? 'teal' : undefined}
              leftSection={copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
              onClick={copy}
            >
              {copied ? 'Códigos copiados' : 'Copiar códigos'}
            </Button>
          )}
        </CopyButton>
        <Checkbox
          label="Guardei os códigos de recuperação em local seguro"
          checked={saved}
          onChange={(e) => setSaved(e.currentTarget.checked)}
        />
        <Button onClick={() => void finish()} disabled={!saved}>
          Continuar para o painel
        </Button>
      </Stack>
    </AuthLayout>
  );
}

function LogoutLink() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const logout = useMutation({
    mutationFn: authApi.logout,
    onSettled: async () => {
      queryClient.clear();
      await navigate(PATHS.login, { replace: true });
    },
  });
  return (
    <Center>
      {logout.isPending ? (
        <Loader size="xs" />
      ) : (
        <Anchor component="button" type="button" size="sm" c="dimmed" onClick={() => logout.mutate()}>
          Sair e configurar depois
        </Anchor>
      )}
    </Center>
  );
}
