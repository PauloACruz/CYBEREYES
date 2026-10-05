import { useState } from 'react';
import { Button, CopyButton, Group, Menu, Modal, Stack, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconChevronDown, IconDeviceDesktop, IconDeviceDesktopShare, IconFolder, IconScreenShare, IconTerminal2, type Icon } from '@tabler/icons-react';
import { useMutation } from '@tanstack/react-query';
import { ApiError } from '../../../api/client';
import { meshApi } from '../../../api/mesh';
import type { AgentDetail, RdpAccessDto, RemoteView } from '../../../api/types';

const VIEWS: { view: RemoteView; label: string; icon: Icon }[] = [
  { view: 'control', label: 'Tela', icon: IconDeviceDesktop },
  { view: 'terminal', label: 'Terminal', icon: IconTerminal2 },
  { view: 'files', label: 'Arquivos', icon: IconFolder },
];

const HTTP_URL = /^https?:\/\//i;

function remoteErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 503 && error.code === 'MESH_DISABLED') return 'O acesso remoto não está configurado no servidor.';
    if (error.status === 409) return 'Este agente ainda não tem o MeshAgent instalado ou sincronizado.';
    return error.title;
  }
  return error instanceof Error ? error.message : 'Não foi possível abrir o acesso remoto.';
}

/** Abre a URL numa janela ja aberta no clique (o bloqueador de pop-ups barra janelas abertas depois). */
function navigate(win: Window | null, url: string) {
  if (!HTTP_URL.test(url)) throw new Error('O servidor devolveu um endereço de acesso remoto inválido.');
  if (win) {
    win.opener = null;
    win.location.href = url;
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export function RemoteAccessMenu({ agent }: { agent: Pick<AgentDetail, 'id' | 'plat'> }) {
  const [rdp, setRdp] = useState<RdpAccessDto | null>(null);
  const openRdp = useMutation({
    mutationFn: async () => {
      const win = window.open('about:blank', '_blank');
      try {
        const access = await meshApi.rdp(agent.id);
        navigate(win, access.url);
        return access;
      } catch (error) {
        win?.close();
        throw error;
      }
    },
    onSuccess: setRdp,
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) return;
      notifications.show({ color: 'red', title: 'Tela via RDP', message: remoteErrorMessage(error) });
    },
  });
  const open = useMutation({
    mutationFn: async (view: RemoteView) => {
      // A janela e aberta no clique para nao ser barrada pelo bloqueador de pop-ups.
      const win = window.open('about:blank', '_blank');
      try {
        const links = await meshApi.remote(agent.id);
        navigate(win, links[view]);
      } catch (error) {
        win?.close();
        throw error;
      }
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) return;
      notifications.show({ color: 'red', title: 'Acesso remoto', message: remoteErrorMessage(error) });
    },
  });

  return (
    <>
      <Menu position="bottom-end" width={220} shadow="md">
        <Menu.Target>
          <Button
            variant="light"
            leftSection={<IconScreenShare size={16} />}
            rightSection={<IconChevronDown size={16} />}
            loading={open.isPending || openRdp.isPending}
          >
            Acesso remoto
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          {VIEWS.map(({ view, label, icon: ViewIcon }) => (
            <Menu.Item key={view} leftSection={<ViewIcon size={16} />} onClick={() => open.mutate(view)}>
              {label}
            </Menu.Item>
          ))}
          {agent.plat === 'linux' && (
            <Menu.Item
              leftSection={<IconDeviceDesktopShare size={16} />}
              title="Para Linux com sessão Wayland (GNOME recente), em que a Tela não mostra imagem"
              onClick={() => openRdp.mutate()}
            >
              Tela via RDP (Wayland)
            </Menu.Item>
          )}
        </Menu.Dropdown>
      </Menu>
      <RdpCredentialsModal access={rdp} onClose={() => setRdp(null)} />
    </>
  );
}

function RdpCredentialsModal({ access, onClose }: { access: RdpAccessDto | null; onClose: () => void }) {
  return (
    <Modal opened={access !== null} onClose={onClose} title="Tela via RDP" centered>
      {access && (
        <Stack>
          <Text size="sm">
            O Web-RDP abriu em outra aba. Informe estas credenciais lá (domínio em branco). A sessão de{' '}
            {access.sessionUser ?? 'usuário'} é compartilhada e o usuário vê que há alguém conectado; se a tela for bloqueada, a conexão cai.
          </Text>
          {(
            [
              ['Usuário', access.username],
              ['Senha', access.password],
            ] as const
          ).map(([label, value]) => (
            <Group key={label} align="flex-end" gap="xs" wrap="nowrap">
              <TextInput label={label} value={value} readOnly style={{ flex: 1 }} ff="monospace" />
              <CopyButton value={value}>
                {({ copied, copy }) => (
                  <Button variant="light" onClick={copy}>
                    {copied ? 'Copiado' : 'Copiar'}
                  </Button>
                )}
              </CopyButton>
            </Group>
          ))}
          <Text size="xs" c="dimmed">
            A senha vale até o próximo pedido de acesso RDP a esta máquina.
          </Text>
        </Stack>
      )}
    </Modal>
  );
}
