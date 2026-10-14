import { useState } from 'react';
import { Alert, Box, Button, Group, Loader, Stack, Switch, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconBell, IconBellOff, IconInfoCircle, IconSend } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_PUSH_PREFERENCES, pushApi } from '../../api/push';
import type { PushPreferences } from '../../api/types';
import { notifySuccess } from '../../lib/feedback';
import { disablePush, enablePush, notificationPermission, PushBlockedError, pushDevice, pushSupport, savePreferences } from './pushClient';

const DEVICE_KEY = ['push', 'device'] as const;
const DIVIDER = { borderTop: '1px solid var(--ce-border-subtle)' } as const;

const OPTIONS: { key: keyof PushPreferences; label: string; description: string }[] = [
  { key: 'newTickets', label: 'Chamados novos', description: 'Chamado aberto sem responsável, ou já atribuído a você.' },
  { key: 'updates', label: 'Atualizações dos meus chamados', description: 'Chamado atribuído a você e mudanças de status ou prioridade.' },
  { key: 'messages', label: 'Mensagens', description: 'Respostas do solicitante e notas de outros técnicos nos seus chamados.' },
];

function Notice({ children }: { children: string }) {
  return (
    <Alert variant="light" color="gray" icon={<IconInfoCircle size={18} />} p="sm">
      <Text size="sm">{children}</Text>
    </Alert>
  );
}

interface NotificationSettingsProps {
  /** Linhas de 64px com o padrao do app; no console, o espacamento do modal. */
  mobile?: boolean;
}

/**
 * Notificacoes de chamados neste aparelho (Web Push): ligar ou desligar, o que avisar e um envio de teste.
 * A escolha e por aparelho: o celular e o computador do mesmo tecnico podem avisar coisas diferentes.
 */
export function NotificationSettings({ mobile = false }: NotificationSettingsProps) {
  const queryClient = useQueryClient();
  const support = pushSupport();
  const [permission, setPermission] = useState(notificationPermission);
  const device = useQuery({ queryKey: DEVICE_KEY, queryFn: pushDevice, enabled: support === 'supported', staleTime: Infinity });
  const endpoint = device.data?.subscription?.endpoint;
  const server = useQuery({
    queryKey: ['push', 'subscription', endpoint],
    queryFn: () => pushApi.find(endpoint ?? ''),
    enabled: Boolean(endpoint),
    retry: false,
  });
  const active = Boolean(endpoint && server.data);
  const preferences: PushPreferences = server.data ?? DEFAULT_PUSH_PREFERENCES;

  const refresh = async () => {
    setPermission(notificationPermission());
    await queryClient.invalidateQueries({ queryKey: ['push'] });
  };

  const enable = useMutation({
    mutationFn: (request: Promise<NotificationPermission>) => enablePush(request, preferences),
    onSuccess: async () => {
      await refresh();
      notifySuccess('Os avisos dos chamados vão aparecer neste aparelho.', 'Notificações ativadas');
    },
    onError: async (error) => {
      await refresh();
      if (error instanceof PushBlockedError) return;
      notifications.show({ color: 'red', title: 'Notificações indisponíveis', message: 'Este navegador não concluiu a inscrição. Tente de novo.' });
    },
  });

  const disable = useMutation({ mutationFn: disablePush, onSettled: refresh });

  const update = useMutation({
    mutationFn: (next: PushPreferences) => {
      const current = device.data?.subscription;
      if (!current) throw new Error('Aparelho sem inscrição');
      return savePreferences(current, next);
    },
    onSuccess: (saved) => queryClient.setQueryData(['push', 'subscription', saved.endpoint], saved),
  });

  const test = useMutation({
    mutationFn: () => pushApi.test(endpoint ?? ''),
    onSuccess: async (result) => {
      if (result.delivered) {
        notifySuccess('A notificação de teste deve aparecer em alguns segundos.', 'Teste enviado');
        return;
      }
      await refresh();
      notifications.show({ color: 'red', title: 'Teste não entregue', message: result.error ?? 'O serviço de push recusou o envio.' });
    },
  });

  if (support === 'needs-install') {
    return (
      <Notice>
        No iPhone, as notificações chegam só pelo app instalado: no Safari, toque em Compartilhar › Adicionar à Tela de Início e abra o CYBEREYES pelo
        ícone.
      </Notice>
    );
  }
  if (support === 'unsupported') return <Notice>Este navegador não recebe notificações.</Notice>;
  if (device.isPending || (endpoint && server.isPending)) {
    return (
      <Group justify="center" py="md">
        <Loader size="sm" aria-label="Carregando notificações" />
      </Group>
    );
  }
  if (device.data && !device.data.worker) return <Notice>As notificações funcionam só no endereço publicado do console.</Notice>;

  const busy = enable.isPending || disable.isPending;
  const px = mobile ? 16 : 0;
  const py = mobile ? 12 : 8;

  return (
    <Stack gap={0}>
      <Box px={px} py={py}>
        <Switch
          size="md"
          labelPosition="left"
          label="Notificações neste aparelho"
          description={
            permission === 'denied'
              ? 'Bloqueadas no navegador: libere as notificações deste site nas configurações e volte aqui.'
              : 'Avisos do sistema, mesmo com o app ou o console fechados.'
          }
          checked={active}
          disabled={busy || (permission === 'denied' && !active)}
          onChange={(event) => {
            // O pedido de permissao sai aqui, no proprio toque (o Safari recusa fora do gesto).
            if (event.currentTarget.checked) enable.mutate('Notification' in window ? Notification.requestPermission() : Promise.resolve('denied'));
            else disable.mutate();
          }}
          thumbIcon={active ? <IconBell size={12} /> : <IconBellOff size={12} />}
          styles={{ body: { justifyContent: 'space-between' }, labelWrapper: { flex: 1 } }}
        />
      </Box>
      {active && (
        <>
          {OPTIONS.map((option) => (
            <Box key={option.key} px={px} py={py} style={DIVIDER}>
              <Switch
                size="md"
                labelPosition="left"
                label={option.label}
                description={option.description}
                checked={preferences[option.key]}
                disabled={update.isPending}
                onChange={(event) => update.mutate({ ...preferences, [option.key]: event.currentTarget.checked })}
                styles={{ body: { justifyContent: 'space-between' }, labelWrapper: { flex: 1 } }}
              />
            </Box>
          ))}
          <Box px={px} py={py} style={DIVIDER}>
            <Button variant="default" leftSection={<IconSend size={16} />} loading={test.isPending} onClick={() => test.mutate()} fullWidth={mobile}>
              Enviar notificação de teste
            </Button>
          </Box>
        </>
      )}
    </Stack>
  );
}
