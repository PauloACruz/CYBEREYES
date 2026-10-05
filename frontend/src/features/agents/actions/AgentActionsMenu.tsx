import { useState } from 'react';
import { Button, Group, Loader, Menu, Modal, Stack, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconChevronDown, IconCloudDownload, IconExternalLink, IconFirstAidKit, IconPlugConnected, IconPower, IconRefresh, IconRotateClockwise } from '@tabler/icons-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { agentActionsApi } from '../../../api/agentActions';
import { meshApi } from '../../../api/mesh';
import { remoteApi } from '../../../api/remote';
import { queryKeys } from '../../../api/queryKeys';
import { urlActionsApi } from '../../../api/settings';
import type { AgentDetail, UrlActionDto } from '../../../api/types';
import { confirmAction, notifySuccess } from '../../../lib/feedback';

const BLOCKED_SCHEMES = /^\s*(javascript|data|vbscript):/i;

interface AgentActionsMenuProps {
  agent: AgentDetail;
  canControl: boolean;
}

export function AgentActionsMenu({ agent, canControl }: AgentActionsMenuProps) {
  const [opened, setOpened] = useState(false);
  const [shutdownOpen, setShutdownOpen] = useState(false);
  const urlActions = useQuery({ queryKey: queryKeys.urlActions, queryFn: urlActionsApi.list, enabled: opened, staleTime: 60_000 });

  const reboot = useMutation({
    mutationFn: () => agentActionsApi.reboot(agent.id),
    onSuccess: () => notifySuccess(`Pedido de reinício enviado para ${agent.hostname}.`),
  });
  const refresh = useMutation({
    mutationFn: () => agentActionsApi.refresh(agent.id),
    onSuccess: () => notifySuccess(`${agent.hostname} vai reenviar o inventário em instantes.`),
  });
  const wake = useMutation({
    mutationFn: () => remoteApi.wake(agent.id),
    onSuccess: (res) => notifySuccess(`Wake-on-LAN enviado por ${res.via}.`),
  });
  const recoverMesh = useMutation({
    mutationFn: () => meshApi.recover(agent.id),
    onSuccess: () => notifySuccess('Recuperação do MeshAgent solicitada.'),
  });
  const updateAgent = useMutation({
    mutationFn: () => agentActionsApi.updateAgent(agent.id),
    onSuccess: (r) => notifySuccess(`${agent.hostname} está atualizando o EYES para ${r.version}; o agente reconecta em instantes.`),
  });
  const openUrl = useMutation({
    mutationFn: async (action: UrlActionDto) => {
      // A janela e aberta no clique para nao ser barrada pelo bloqueador de pop-ups.
      const win = window.open('about:blank', '_blank');
      try {
        const { url } = await agentActionsApi.urlAction(agent.id, action.id);
        if (BLOCKED_SCHEMES.test(url)) throw new Error('URL não permitida');
        if (win) {
          win.opener = null;
          win.location.href = url;
        } else {
          window.open(url, '_blank', 'noopener,noreferrer');
        }
      } catch (error) {
        win?.close();
        throw error;
      }
    },
    onError: (error) => {
      if (error instanceof Error && error.message === 'URL não permitida') {
        notifications.show({ color: 'red', title: 'URL action', message: 'A URL gerada usa um esquema não permitido.' });
      }
    },
  });

  const confirmReboot = () =>
    confirmAction({
      title: 'Reiniciar máquina',
      message: `Reiniciar ${agent.hostname} agora? O usuário logado pode perder trabalho não salvo.`,
      confirmLabel: 'Reiniciar',
      danger: true,
      onConfirm: () => reboot.mutate(),
    });

  const confirmRecoverMesh = () =>
    confirmAction({
      title: 'Recuperar MeshAgent',
      message: `Reinstalar o MeshAgent em ${agent.hostname}? O acesso remoto fica indisponível até a reinstalação terminar.`,
      confirmLabel: 'Recuperar',
      onConfirm: () => recoverMesh.mutate(),
    });

  const confirmUpdate = () =>
    confirmAction({
      title: 'Atualizar EYES',
      message: `Atualizar o agente de ${agent.hostname} (versão ${agent.version}) para a versão distribuída pelo servidor? O serviço reinicia sozinho.`,
      confirmLabel: 'Atualizar',
      onConfirm: () => updateAgent.mutate(),
    });

  const busy = reboot.isPending || refresh.isPending || openUrl.isPending || wake.isPending || recoverMesh.isPending || updateAgent.isPending;

  return (
    <>
      <Menu position="bottom-end" width={240} shadow="md" opened={opened} onChange={setOpened}>
        <Menu.Target>
          <Button variant="light" rightSection={<IconChevronDown size={16} />} loading={busy}>
            Ações
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item leftSection={<IconRefresh size={16} />} onClick={() => refresh.mutate()}>
            Atualizar inventário
          </Menu.Item>
          {canControl && (
            <>
              <Menu.Divider />
              <Menu.Label>Energia</Menu.Label>
              <Menu.Item leftSection={<IconRotateClockwise size={16} />} onClick={confirmReboot}>
                Reiniciar
              </Menu.Item>
              <Menu.Item color="red" leftSection={<IconPower size={16} />} onClick={() => setShutdownOpen(true)}>
                Desligar
              </Menu.Item>
              <Menu.Item leftSection={<IconPlugConnected size={16} />} onClick={() => wake.mutate()}>
                Wake-on-LAN
              </Menu.Item>
              <Menu.Divider />
              <Menu.Label>Agente</Menu.Label>
              <Menu.Item leftSection={<IconCloudDownload size={16} />} onClick={confirmUpdate}>
                Atualizar EYES
              </Menu.Item>
              <Menu.Divider />
              <Menu.Label>MeshCentral</Menu.Label>
              <Menu.Item leftSection={<IconFirstAidKit size={16} />} onClick={confirmRecoverMesh}>
                Recuperar MeshAgent
              </Menu.Item>
            </>
          )}
          <Menu.Divider />
          <Menu.Label>URL actions</Menu.Label>
          {urlActions.isPending && (
            <Menu.Item disabled leftSection={<Loader size={14} />}>
              Carregando...
            </Menu.Item>
          )}
          {urlActions.isError && <Menu.Item disabled>Não foi possível carregar</Menu.Item>}
          {urlActions.isSuccess && urlActions.data.length === 0 && <Menu.Item disabled>Nenhuma URL action cadastrada</Menu.Item>}
          {urlActions.data?.map((action) => (
            <Menu.Item key={action.id} leftSection={<IconExternalLink size={16} />} title={action.description} onClick={() => openUrl.mutate(action)}>
              {action.name}
            </Menu.Item>
          ))}
        </Menu.Dropdown>
      </Menu>
      {canControl && <ShutdownModal agent={agent} opened={shutdownOpen} onClose={() => setShutdownOpen(false)} />}
    </>
  );
}

function ShutdownModal({ agent, opened, onClose }: { agent: AgentDetail; opened: boolean; onClose: () => void }) {
  const [typed, setTyped] = useState('');
  const close = () => {
    setTyped('');
    onClose();
  };
  const shutdown = useMutation({
    mutationFn: () => agentActionsApi.shutdown(agent.id),
    onSuccess: () => {
      notifySuccess(`Pedido de desligamento enviado para ${agent.hostname}.`);
      close();
    },
  });
  const matches = typed.trim() === agent.hostname;
  return (
    <Modal opened={opened} onClose={close} title="Desligar máquina" centered>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (matches) shutdown.mutate();
        }}
        noValidate
      >
        <Stack>
          <Text size="sm">
            A máquina será desligada e só voltará a responder quando alguém ligá-la fisicamente ou por Wake-on-LAN. Para confirmar, digite o nome{' '}
            <Text span fw={700} ff="monospace">
              {agent.hostname}
            </Text>
            .
          </Text>
          <TextInput label="Nome da máquina" data-autofocus autoComplete="off" value={typed} onChange={(e) => setTyped(e.currentTarget.value)} />
          <Group justify="flex-end">
            <Button variant="default" onClick={close}>
              Cancelar
            </Button>
            <Button type="submit" color="red" disabled={!matches} loading={shutdown.isPending}>
              Desligar
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
