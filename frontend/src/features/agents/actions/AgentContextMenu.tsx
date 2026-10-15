import { useRef } from 'react';
import { Box, Menu, Text } from '@mantine/core';
import { IconArrowsExchange, IconCode, IconDeviceDesktopShare, IconFolders, IconPencil, IconPower, IconPrompt, IconRefresh, IconRocket } from '@tabler/icons-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { agentActionsApi } from '../../../api/agentActions';
import { agentsApi } from '../../../api/agents';
import { queryKeys } from '../../../api/queryKeys';
import { PERMISSIONS, type AgentListItem } from '../../../api/types';
import { agentPath } from '../../../app/paths';
import { hasPermission } from '../../../auth/permissions';
import { useMe } from '../../../auth/useMe';
import { confirmAction, notifySuccess } from '../../../lib/feedback';
import { ShutdownModal } from './AgentActionsMenu';
import { openRemoteWindow } from './openRemoteWindow';
import { MoveAgentModal } from './MoveAgentModal';
import { RenameComputerModal } from './RenameComputerModal';
import { isWindows } from './shells';

export type AgentMenuDialog = 'rename' | 'shutdown' | 'move' | null;

interface AgentContextMenuProps {
  agent: AgentListItem;
  /** Posicao do clique, relativa a janela. */
  x: number;
  y: number;
  onClose: () => void;
  /** Dialogo aberto a partir do menu (fica fora do menu para sobreviver ao fechamento dele). */
  dialog: AgentMenuDialog;
  onDialog: (dialog: AgentMenuDialog) => void;
}

/** Menu do botao direito numa linha da lista de agentes: as acoes mais usadas sem abrir o detalhe. */
export function AgentContextMenu({ agent, x, y, onClose, dialog, onDialog }: AgentContextMenuProps) {
  const { data: me } = useMe();
  const navigate = useNavigate();
  const online = agent.status === 'online';
  const canControl = hasPermission(me, PERMISSIONS.agentsControl);
  const canRemote = hasPermission(me, PERMISSIONS.agentsRemote);
  const canFiles = hasPermission(me, PERMISSIONS.agentsFiles);
  const canRun = hasPermission(me, PERMISSIONS.agentsRun);
  const canScripts = canRun && hasPermission(me, PERMISSIONS.scriptsView);
  const canRename = canControl && isWindows(agent.plat);
  const canManage = hasPermission(me, PERMISSIONS.agentsManage);
  // O modal de renomear precisa do WMI (dominio ou grupo de trabalho), que so vem no detalhe.
  const detail = useQuery({ queryKey: queryKeys.agentDetail(agent.id), queryFn: () => agentsApi.get(agent.id), enabled: dialog === 'rename' });

  const reboot = useMutation({
    mutationFn: () => agentActionsApi.reboot(agent.id),
    onSuccess: () => notifySuccess(`Pedido de reinício enviado para ${agent.hostname}.`),
  });
  // O Menu fecha sozinho ao clicar num item; quando o item abre um dialogo, esse fechamento nao pode descartar o dialogo.
  const openingDialog = useRef(false);
  const openDialog = (next: Exclude<AgentMenuDialog, null>) => {
    openingDialog.current = true;
    onDialog(next);
  };
  const onMenuChange = (opened: boolean) => {
    if (opened) return;
    if (openingDialog.current) {
      openingDialog.current = false;
      return;
    }
    onClose();
  };
  const goTo = (tab: string) => void navigate(`${agentPath(agent.id)}?aba=${tab}`);
  const note = online ? null : agent.status === 'offline' ? 'Agente offline: as ações voltam quando ele se conectar.' : 'Em atraso: o agente pode não responder agora.';

  return (
    <>
      <Menu opened={dialog === null} onChange={onMenuChange} position="bottom-start" offset={2} width={240} shadow="md" withinPortal>
        <Menu.Target>
          {/* Ancora invisivel no ponto do clique; o Mantine usa o rotulo dela como nome do menu. */}
          <Box pos="fixed" left={x} top={y} w={1} h={1} aria-label={`Ações de ${agent.hostname}`} style={{ pointerEvents: 'none' }} />
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>
            <Text size="sm" ff="monospace" c="var(--mantine-color-text)" fw={500}>
              {agent.hostname}
            </Text>
            {note && (
              <Text size="xs" c={agent.status === 'offline' ? 'red' : 'orange'} mt={2}>
                {note}
              </Text>
            )}
          </Menu.Label>
          <Menu.Divider />
          {canRename && (
            <Menu.Item leftSection={<IconPencil size={16} />} disabled={!online} onClick={() => openDialog('rename')}>
              Alterar hostname
            </Menu.Item>
          )}
          {canManage && (
            <Menu.Item leftSection={<IconArrowsExchange size={16} />} onClick={() => openDialog('move')}>
              Mudar cliente ou site
            </Menu.Item>
          )}
          {canRemote && (
            <Menu.Item leftSection={<IconDeviceDesktopShare size={16} />} disabled={!online} onClick={() => openRemoteWindow(agent.id)}>
              Acesso remoto
            </Menu.Item>
          )}
          {canFiles && (
            <Menu.Item leftSection={<IconFolders size={16} />} disabled={!online} onClick={() => goTo('arquivos')}>
              Arquivos
            </Menu.Item>
          )}
          {(canRun || canScripts || (canControl && isWindows(agent.plat))) && <Menu.Divider />}
          {canRun && (
            <Menu.Item leftSection={<IconPrompt size={16} />} disabled={!online} onClick={() => goTo('comando')}>
              Enviar comando
            </Menu.Item>
          )}
          {canScripts && (
            <Menu.Item leftSection={<IconCode size={16} />} disabled={!online} onClick={() => goTo('scripts')}>
              Executar script
            </Menu.Item>
          )}
          {canControl && isWindows(agent.plat) && (
            <Menu.Item leftSection={<IconRocket size={16} />} disabled={!online} onClick={() => goTo('inicializacao')}>
              Programas da inicialização
            </Menu.Item>
          )}
          {canControl && (
            <>
              <Menu.Divider />
              <Menu.Item
                leftSection={<IconRefresh size={16} />}
                disabled={!online}
                onClick={() =>
                  confirmAction({
                    title: 'Reiniciar máquina',
                    message: `Reiniciar ${agent.hostname} agora? O usuário logado pode perder trabalho não salvo.`,
                    confirmLabel: 'Reiniciar',
                    danger: true,
                    onConfirm: () => reboot.mutate(),
                  })
                }
              >
                Reiniciar
              </Menu.Item>
              <Menu.Item leftSection={<IconPower size={16} />} color="red" disabled={!online} onClick={() => openDialog('shutdown')}>
                Desligar
              </Menu.Item>
            </>
          )}
          {!canControl && !canRemote && !canFiles && !canRun && !canManage && (
            <Menu.Item disabled>Seu papel não tem ações para este agente.</Menu.Item>
          )}
        </Menu.Dropdown>
      </Menu>
      {dialog === 'rename' && detail.data && <RenameComputerModal agent={detail.data} opened onClose={onClose} />}
      <ShutdownModal agent={agent} opened={dialog === 'shutdown'} onClose={onClose} />
      {dialog === 'move' && <MoveAgentModal agent={agent} opened onClose={onClose} />}
    </>
  );
}
