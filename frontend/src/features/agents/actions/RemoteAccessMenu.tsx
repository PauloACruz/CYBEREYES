import { Button, Menu } from '@mantine/core';
import { IconChevronDown, IconDeviceDesktop, IconEye, IconScreenShare } from '@tabler/icons-react';
import type { AgentDetail } from '../../../api/types';
import { openRemoteWindow } from './openRemoteWindow';

export function RemoteAccessMenu({ agent, ticketId }: { agent: Pick<AgentDetail, 'id'>; ticketId?: number }) {
  return (
    <Menu position="bottom-end" width={220} shadow="md">
      <Menu.Target>
        <Button variant="light" leftSection={<IconScreenShare size={16} />} rightSection={<IconChevronDown size={16} />}>
          Acesso remoto
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item leftSection={<IconDeviceDesktop size={16} />} onClick={() => openRemoteWindow(agent.id, { ticketId })}>
          Tela
        </Menu.Item>
        <Menu.Item leftSection={<IconEye size={16} />} onClick={() => openRemoteWindow(agent.id, { viewOnly: true, ticketId })}>
          Somente visualizar
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
