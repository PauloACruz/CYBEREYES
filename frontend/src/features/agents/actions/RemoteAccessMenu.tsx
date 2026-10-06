import { Button, Menu } from '@mantine/core';
import { IconChevronDown, IconDeviceDesktop, IconEye, IconFolders, IconScreenShare, IconTerminal2 } from '@tabler/icons-react';
import { Link } from 'react-router';
import { PERMISSIONS, type AgentDetail } from '../../../api/types';
import { agentPath } from '../../../app/paths';
import { hasPermission } from '../../../auth/permissions';
import { useMe } from '../../../auth/useMe';
import { openRemoteWindow } from './openRemoteWindow';

/** Acesso remoto pelo EYES: tela (janela propria), terminal e arquivos (abas do agente). */
export function RemoteAccessMenu({ agent, ticketId }: { agent: Pick<AgentDetail, 'id'>; ticketId?: number }) {
  const { data: me } = useMe();
  const canTerminal = hasPermission(me, PERMISSIONS.agentsRun);
  const canFiles = hasPermission(me, PERMISSIONS.agentsFiles);
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
        {canTerminal && (
          <Menu.Item leftSection={<IconTerminal2 size={16} />} component={Link} to={`${agentPath(agent.id)}?aba=terminal`}>
            Terminal
          </Menu.Item>
        )}
        {canFiles && (
          <Menu.Item leftSection={<IconFolders size={16} />} component={Link} to={`${agentPath(agent.id)}?aba=arquivos`}>
            Arquivos
          </Menu.Item>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}
