import {
  IconBuilding,
  IconDeviceDesktop,
  IconHome,
  IconKey,
  IconListDetails,
  IconRocket,
  IconShieldLock,
  IconUsers,
  type Icon,
} from '@tabler/icons-react';
import { PERMISSIONS } from '../api/types';
import type { MeDto } from '../api/types';
import { hasPermission } from '../auth/permissions';
import { PATHS } from './paths';

export interface NavItem {
  label: string;
  to: string;
  icon: Icon;
  permission?: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Painel', to: PATHS.dashboard, icon: IconHome },
  { label: 'Agentes', to: PATHS.agents, icon: IconDeviceDesktop, permission: PERMISSIONS.agentsView },
  { label: 'Clientes', to: PATHS.clients, icon: IconBuilding, permission: PERMISSIONS.clientsView },
  { label: 'Implantações', to: PATHS.deployments, icon: IconRocket, permission: PERMISSIONS.agentsInstall },
  { label: 'Usuários', to: PATHS.users, icon: IconUsers, permission: PERMISSIONS.usersView },
  { label: 'Papéis', to: PATHS.roles, icon: IconShieldLock, permission: PERMISSIONS.rolesManage },
  { label: 'Chaves de API', to: PATHS.apiKeys, icon: IconKey, permission: PERMISSIONS.apiKeysManage },
  { label: 'Auditoria', to: PATHS.audit, icon: IconListDetails, permission: PERMISSIONS.auditView },
];

export function visibleNavItems(me: MeDto | undefined): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.permission || hasPermission(me, item.permission));
}
