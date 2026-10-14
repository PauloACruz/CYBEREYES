import { useState, type ReactNode } from 'react';
import { Box, Button, Drawer, Group, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconCode, IconDeviceDesktopShare, IconFolders, IconHeartRateMonitor, IconPencil, IconPower, IconPrompt, IconRefresh } from '@tabler/icons-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { agentActionsApi } from '../../../api/agentActions';
import { agentsApi } from '../../../api/agents';
import { queryKeys } from '../../../api/queryKeys';
import { PERMISSIONS, type AgentListItem } from '../../../api/types';
import { agentPath, mobileCarePath, mobileCommandPath } from '../../../app/paths';
import { hasPermission } from '../../../auth/permissions';
import { useMe } from '../../../auth/useMe';
import { confirmAction, notifySuccess } from '../../../lib/feedback';
import { AgentStatusBadge } from '../../agents/agentDisplay';
import { ShutdownModal } from '../../agents/actions/AgentActionsMenu';
import { openRemoteWindow } from '../../agents/actions/openRemoteWindow';
import { RenameComputerModal } from '../../agents/actions/RenameComputerModal';
import { isWindows } from '../../agents/actions/shells';
import { CARE_NAME } from '../../care/careFormat';

export type MobileAgentRef = Pick<AgentListItem, 'id' | 'hostname' | 'status' | 'plat' | 'clientName' | 'siteName'>;

interface ItemProps {
  icon: ReactNode;
  label: string;
  hint?: string;
  to?: string;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
}

function Item({ icon, label, hint, to, onClick, disabled = false, danger = false }: ItemProps) {
  const color = disabled ? 'var(--ce-text-tertiary)' : danger ? 'var(--mantine-color-red-6)' : 'var(--ce-text-primary)';
  const content = (
    <Group gap={14} wrap="nowrap" mih={52} px={20} style={{ color, opacity: disabled ? 0.6 : 1 }}>
      <Box display="flex" c={disabled ? undefined : danger ? 'red' : 'var(--ce-text-secondary)'}>
        {icon}
      </Box>
      <Text c="inherit" size="md" style={{ flex: 1 }}>
        {label}
      </Text>
      {hint && (
        <Text size="xs" c="var(--ce-text-tertiary)">
          {hint}
        </Text>
      )}
    </Group>
  );
  if (to && !disabled) {
    return (
      <UnstyledButton component={Link} to={to} display="block" role="menuitem">
        {content}
      </UnstyledButton>
    );
  }
  return (
    <UnstyledButton display="block" w="100%" role="menuitem" disabled={disabled} aria-disabled={disabled} onClick={onClick}>
      {content}
    </UnstyledButton>
  );
}

const SEPARATOR = <Box role="separator" h={1} mx={20} my={4} bg="var(--ce-border-subtle)" />;

interface MobileAgentActionsProps {
  agent: MobileAgentRef | null;
  onClose: () => void;
}

/** Folha de acoes do agente (o menu do botao direito do console, no celular). */
export function MobileAgentActions({ agent, onClose }: MobileAgentActionsProps) {
  const [dialog, setDialog] = useState<{ kind: 'rename' | 'shutdown'; agent: MobileAgentRef } | null>(null);
  // Fica aqui (e nao na lista) porque a folha fecha antes da confirmacao.
  const reboot = useMutation({
    mutationFn: (target: MobileAgentRef) => agentActionsApi.reboot(target.id),
    onSuccess: (_, target) => notifySuccess(`Pedido de reinício enviado para ${target.hostname}.`),
  });
  return (
    <>
      <Drawer
        opened={agent !== null}
        onClose={onClose}
        position="bottom"
        size="auto"
        withCloseButton={false}
        radius={15}
        padding={0}
        styles={{ content: { paddingBottom: 'env(safe-area-inset-bottom)' } }}
        title={null}
        aria-label={agent ? `Ações de ${agent.hostname}` : undefined}
      >
        {agent && (
          <ActionList
            agent={agent}
            onClose={onClose}
            onReboot={() => reboot.mutate(agent)}
            onDialog={(kind) => {
              setDialog({ kind, agent });
              onClose();
            }}
          />
        )}
      </Drawer>
      {dialog?.kind === 'rename' && <RenameDialog agentId={dialog.agent.id} onClose={() => setDialog(null)} />}
      {dialog && <ShutdownModal agent={dialog.agent} opened={dialog.kind === 'shutdown'} onClose={() => setDialog(null)} />}
    </>
  );
}

function RenameDialog({ agentId, onClose }: { agentId: number; onClose: () => void }) {
  // O modal precisa do WMI (dominio ou grupo de trabalho), que so vem no detalhe.
  const detail = useQuery({ queryKey: queryKeys.agentDetail(agentId), queryFn: () => agentsApi.get(agentId) });
  return detail.data ? <RenameComputerModal agent={detail.data} opened onClose={onClose} /> : null;
}

interface ActionListProps {
  agent: MobileAgentRef;
  onClose: () => void;
  onReboot: () => void;
  onDialog: (kind: 'rename' | 'shutdown') => void;
}

function ActionList({ agent, onClose, onReboot, onDialog }: ActionListProps) {
  const { data: me } = useMe();
  const online = agent.status === 'online';
  const canControl = hasPermission(me, PERMISSIONS.agentsControl);
  const canRemote = hasPermission(me, PERMISSIONS.agentsRemote);
  const canFiles = hasPermission(me, PERMISSIONS.agentsFiles);
  const canRun = hasPermission(me, PERMISSIONS.agentsRun);
  const canScripts = canRun && hasPermission(me, PERMISSIONS.scriptsView);
  const offlineHint = online ? undefined : 'agente offline';

  return (
    <Stack gap={0} py={8} role="menu" aria-label={`Ações de ${agent.hostname}`}>
      <Box w={40} h={4} mx="auto" mb={12} bg="var(--ce-border-strong)" style={{ borderRadius: 2 }} aria-hidden />
      <Stack gap={4} px={20} pb={12}>
        <Text ff="monospace" fw={500} size="md">
          {agent.hostname}
        </Text>
        <Group gap={8}>
          <AgentStatusBadge status={agent.status} />
          <Text size="sm" c="var(--ce-text-secondary)">
            {agent.clientName} · {agent.siteName}
          </Text>
        </Group>
        {agent.status === 'offline' && (
          <Text size="xs" c="red">
            Agente offline: as ações voltam quando ele se conectar.
          </Text>
        )}
      </Stack>
      {SEPARATOR}
      <Item icon={<IconHeartRateMonitor size={22} />} label={CARE_NAME} to={mobileCarePath(agent.id)} />
      {canRun && <Item icon={<IconPrompt size={22} />} label="Enviar comando" to={mobileCommandPath(agent.id)} />}
      {canScripts && <Item icon={<IconCode size={22} />} label="Executar script" hint="no console" to={`${agentPath(agent.id)}?aba=scripts`} />}
      {canRemote && (
        <Item
          icon={<IconDeviceDesktopShare size={22} />}
          label="Acesso remoto"
          hint={offlineHint}
          disabled={!online}
          onClick={() => {
            openRemoteWindow(agent.id);
            onClose();
          }}
        />
      )}
      {canFiles && <Item icon={<IconFolders size={22} />} label="Arquivos" hint={offlineHint ?? 'no console'} disabled={!online} to={`${agentPath(agent.id)}?aba=arquivos`} />}
      {canControl && isWindows(agent.plat) && (
        <Item icon={<IconPencil size={22} />} label="Alterar hostname" hint={offlineHint} disabled={!online} onClick={() => onDialog('rename')} />
      )}
      {canControl && (
        <>
          {SEPARATOR}
          <Item
            icon={<IconRefresh size={22} />}
            label="Reiniciar"
            hint={offlineHint ?? 'pede confirmação'}
            disabled={!online}
            onClick={() => {
              onClose();
              confirmAction({
                title: 'Reiniciar máquina',
                message: `Reiniciar ${agent.hostname} agora? O usuário logado pode perder trabalho não salvo.`,
                confirmLabel: 'Reiniciar',
                danger: true,
                onConfirm: onReboot,
              });
            }}
          />
          <Item icon={<IconPower size={22} />} label="Desligar" hint={offlineHint ?? 'digite o nome'} danger disabled={!online} onClick={() => onDialog('shutdown')} />
        </>
      )}
      {SEPARATOR}
      <Box px={16} pt={8} pb={8}>
        <Button variant="default" fullWidth size="md" onClick={onClose}>
          Cancelar
        </Button>
      </Box>
    </Stack>
  );
}
