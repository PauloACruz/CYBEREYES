import { useEffect, useState, type ReactNode } from 'react';
import { ActionIcon, Anchor, Box, Group, Stack, Switch, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDeviceMobile, IconFingerprint, IconShieldLock, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authApi } from '../../api/auth';
import { ApiError } from '../../api/client';
import type { PasskeyDto } from '../../api/types';
import { confirmAction, notifySuccess } from '../../lib/feedback';
import { formatDate } from '../../lib/format';
import {
  devicePasskeyId,
  isBiometricsCancelled,
  platformAuthenticatorAvailable,
  registerDevicePasskey,
  setDevicePasskeyId,
} from '../auth/webauthn';
import { MobileSection } from './MobilePage';
import { MOBILE_CARD } from './mobileStyles';

const PASSKEYS_KEY = ['auth', 'passkeys'] as const;
const DEVICE_KEY = ['auth', '2fa-device'] as const;
const DIVIDER = { borderTop: '1px solid var(--ce-border-subtle)' } as const;

interface LineProps {
  icon: ReactNode;
  label: string;
  description: string;
  /** A direita da linha (interruptor, remover). */
  action?: ReactNode;
  /** Abaixo da descricao (link de acao com texto longo). */
  footer?: ReactNode;
}

function Line({ icon, label, description, action, footer }: LineProps) {
  return (
    <Group gap={14} wrap="nowrap" mih={64} px={16} py={10}>
      <Box c="var(--ce-text-secondary)" display="flex">
        {icon}
      </Box>
      <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
        <Text size="md">{label}</Text>
        <Text size="xs" c="var(--ce-text-tertiary)">
          {description}
        </Text>
        {footer}
      </Stack>
      {action}
    </Group>
  );
}

/**
 * Entrada neste celular: biometria no lugar da senha e o prazo em que o codigo do autenticador fica dispensado (30 dias).
 * A credencial da biometria fica no aparelho; o id dela fica no localStorage para o login saber que pode oferece-la.
 */
export function MobileSignInSection() {
  const queryClient = useQueryClient();
  const [available, setAvailable] = useState<boolean | null>(null);
  const passkeys = useQuery({ queryKey: PASSKEYS_KEY, queryFn: authApi.passkeys });
  const device = useQuery({ queryKey: DEVICE_KEY, queryFn: authApi.rememberedDevice });
  const [localId, setLocalId] = useState(devicePasskeyId);

  useEffect(() => {
    let active = true;
    void platformAuthenticatorAvailable().then((value) => {
      if (active) setAvailable(value);
    });
    return () => {
      active = false;
    };
  }, []);

  // Removida em outro aparelho (ou pelo console): o atalho do login deixa de aparecer aqui.
  const list = passkeys.data;
  useEffect(() => {
    if (list && localId && !list.some((p) => p.id === localId)) setDevicePasskeyId(null);
  }, [list, localId]);

  const thisDevice = list?.find((p) => p.id === localId) ?? null;
  const others = list?.filter((p) => p.id !== localId) ?? [];

  const enable = useMutation({
    mutationFn: registerDevicePasskey,
    onSuccess: async (passkey) => {
      setLocalId(passkey.id);
      await queryClient.invalidateQueries({ queryKey: PASSKEYS_KEY });
      notifySuccess('Na próxima entrada, use a biometria no lugar da senha.', 'Biometria ativada');
    },
    onError: (error) => {
      if (isBiometricsCancelled(error) || error instanceof ApiError) return;
      notifications.show({ color: 'red', title: 'Biometria indisponível', message: 'Este celular não concluiu o cadastro da biometria.' });
    },
  });

  const remove = useMutation({
    mutationFn: (passkey: PasskeyDto) => authApi.deletePasskey(passkey.id),
    onSuccess: async (_, passkey) => {
      if (passkey.id === localId) {
        setDevicePasskeyId(null);
        setLocalId(null);
      }
      await queryClient.invalidateQueries({ queryKey: PASSKEYS_KEY });
    },
  });

  const forget = useMutation({
    mutationFn: authApi.forgetDevice,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: DEVICE_KEY });
      notifySuccess('O próximo login neste celular vai pedir o código do autenticador.');
    },
  });

  const toggle = (checked: boolean) => {
    if (checked) enable.mutate();
    else if (thisDevice) remove.mutate(thisDevice);
  };

  const biometricsDescription =
    available === false
      ? 'Este celular não oferece biometria para o navegador'
      : thisDevice
        ? `Ativada neste celular desde ${formatDate(thisDevice.createdAt)}`
        : 'Digital, rosto ou PIN do celular no lugar da senha';

  const remembered = device.data?.remembered === true;
  const codeDescription = remembered
    ? `Dispensado neste celular até ${formatDate(device.data?.expiresAt ?? null)}`
    : 'Pedido no próximo login; marque “Não pedir o código neste celular por 30 dias” ao digitá-lo';

  return (
    <MobileSection title="Entrada neste celular">
      <Box style={MOBILE_CARD}>
        <Line
          icon={<IconFingerprint size={22} />}
          label="Entrar com biometria"
          description={biometricsDescription}
          action={
            <Switch
              size="md"
              aria-label="Entrar com biometria"
              checked={thisDevice !== null}
              disabled={available !== true || passkeys.isPending || enable.isPending || remove.isPending}
              onChange={(e) => toggle(e.currentTarget.checked)}
            />
          }
        />
        <Box style={DIVIDER}>
          <Line
            icon={<IconShieldLock size={22} />}
            label="Código do autenticador"
            description={codeDescription}
            footer={
              remembered && (
                <Anchor component="button" type="button" size="sm" ta="left" mt={4} disabled={forget.isPending} onClick={() => forget.mutate()}>
                  Pedir o código de novo neste celular
                </Anchor>
              )
            }
          />
        </Box>
      </Box>
      {others.length > 0 && (
        <Text size="xs" c="var(--ce-text-secondary)" mt={4}>
          Outros aparelhos com biometria
        </Text>
      )}
      {others.length > 0 && (
        <Box style={MOBILE_CARD}>
          {others.map((passkey, index) => (
            <Box key={passkey.id} style={index > 0 ? DIVIDER : undefined}>
              <Line
                icon={<IconDeviceMobile size={22} />}
                label={passkey.name}
                description={`Biometria cadastrada em ${formatDate(passkey.createdAt)}`}
                action={
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    size={44}
                    aria-label={`Remover a biometria de ${passkey.name}`}
                    onClick={() =>
                      confirmAction({
                        title: 'Remover biometria',
                        message: `${passkey.name} deixa de entrar com biometria; lá vai ser preciso usar a senha.`,
                        confirmLabel: 'Remover',
                        danger: true,
                        onConfirm: () => remove.mutate(passkey),
                      })
                    }
                  >
                    <IconTrash size={20} />
                  </ActionIcon>
                }
              />
            </Box>
          ))}
        </Box>
      )}
    </MobileSection>
  );
}
