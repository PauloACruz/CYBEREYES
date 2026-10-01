import { Button, Menu } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconChevronDown, IconDeviceDesktop, IconFolder, IconScreenShare, IconTerminal2, type Icon } from '@tabler/icons-react';
import { useMutation } from '@tanstack/react-query';
import { ApiError } from '../../../api/client';
import { meshApi } from '../../../api/mesh';
import type { AgentDetail, RemoteView } from '../../../api/types';

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

export function RemoteAccessMenu({ agent }: { agent: AgentDetail }) {
  const open = useMutation({
    mutationFn: async (view: RemoteView) => {
      // A janela e aberta no clique para nao ser barrada pelo bloqueador de pop-ups.
      const win = window.open('about:blank', '_blank');
      try {
        const links = await meshApi.remote(agent.id);
        const url = links[view];
        if (!HTTP_URL.test(url)) throw new Error('O servidor devolveu um endereço de acesso remoto inválido.');
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
      if (error instanceof ApiError && error.status === 401) return;
      notifications.show({ color: 'red', title: 'Acesso remoto', message: remoteErrorMessage(error) });
    },
  });

  return (
    <Menu position="bottom-end" width={200} shadow="md">
      <Menu.Target>
        <Button variant="light" leftSection={<IconScreenShare size={16} />} rightSection={<IconChevronDown size={16} />} loading={open.isPending}>
          Acesso remoto
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        {VIEWS.map(({ view, label, icon: ViewIcon }) => (
          <Menu.Item key={view} leftSection={<ViewIcon size={16} />} onClick={() => open.mutate(view)}>
            {label}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
