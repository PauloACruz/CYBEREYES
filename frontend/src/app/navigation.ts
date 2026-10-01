import {
  IconAlertTriangle,
  IconBook2,
  IconBox,
  IconBuilding,
  IconCode,
  IconDeviceDesktop,
  IconHome,
  IconKey,
  IconListDetails,
  IconReportAnalytics,
  IconLogs,
  IconRocket,
  IconRouter,
  IconShieldCheckered,
  IconSettings,
  IconShieldLock,
  IconTicket,
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
  /** Mostra o contador de alertas ativos ao lado do item. */
  alertCounter?: boolean;
  /** Mostra o contador de chamados abertos sem técnico. */
  ticketCounter?: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Painel', to: PATHS.dashboard, icon: IconHome },
  { label: 'Agentes', to: PATHS.agents, icon: IconDeviceDesktop, permission: PERMISSIONS.agentsView },
  { label: 'Alertas', to: PATHS.alerts, icon: IconAlertTriangle, permission: PERMISSIONS.alertsView, alertCounter: true },
  { label: 'Chamados', to: PATHS.tickets, icon: IconTicket, permission: PERMISSIONS.ticketsView, ticketCounter: true },
  { label: 'Logs', to: PATHS.logs, icon: IconLogs, permission: PERMISSIONS.logsView },
  { label: 'Rede SNMP', to: PATHS.snmp, icon: IconRouter, permission: PERMISSIONS.snmpView },
  { label: 'Inventário', to: PATHS.inventory, icon: IconBox, permission: PERMISSIONS.inventoryView },
  { label: 'Documentação', to: PATHS.docs, icon: IconBook2, permission: PERMISSIONS.docsView },
  { label: 'Relatórios', to: PATHS.reports, icon: IconReportAnalytics, permission: PERMISSIONS.reportsView },
  { label: 'Políticas', to: PATHS.policies, icon: IconShieldCheckered, permission: PERMISSIONS.agentsView },
  { label: 'Clientes', to: PATHS.clients, icon: IconBuilding, permission: PERMISSIONS.clientsView },
  { label: 'Scripts', to: PATHS.scripts, icon: IconCode, permission: PERMISSIONS.scriptsView },
  { label: 'Implantações', to: PATHS.deployments, icon: IconRocket, permission: PERMISSIONS.agentsInstall },
  { label: 'Usuários', to: PATHS.users, icon: IconUsers, permission: PERMISSIONS.usersView },
  { label: 'Papéis', to: PATHS.roles, icon: IconShieldLock, permission: PERMISSIONS.rolesManage },
  { label: 'Chaves de API', to: PATHS.apiKeys, icon: IconKey, permission: PERMISSIONS.apiKeysManage },
  { label: 'Auditoria', to: PATHS.audit, icon: IconListDetails, permission: PERMISSIONS.auditView },
  { label: 'Configurações', to: PATHS.settings, icon: IconSettings, permission: PERMISSIONS.settingsManage },
];

export function visibleNavItems(me: MeDto | undefined): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.permission || hasPermission(me, item.permission));
}
