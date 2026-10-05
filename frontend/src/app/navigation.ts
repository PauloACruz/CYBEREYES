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
  /** Itens agrupados sob este no menu, num grupo recolhível. */
  children?: readonly NavItem[];
}

export const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Painel', to: PATHS.dashboard, icon: IconHome },
  { label: 'Alertas', to: PATHS.alerts, icon: IconAlertTriangle, permission: PERMISSIONS.alertsView, alertCounter: true },
  { label: 'Chamados', to: PATHS.tickets, icon: IconTicket, permission: PERMISSIONS.ticketsView, ticketCounter: true },
  { label: 'Agentes', to: PATHS.agents, icon: IconDeviceDesktop, permission: PERMISSIONS.agentsView },
  { label: 'Relatórios', to: PATHS.reports, icon: IconReportAnalytics, permission: PERMISSIONS.reportsView },
  { label: 'Políticas', to: PATHS.policies, icon: IconShieldCheckered, permission: PERMISSIONS.agentsView },
  { label: 'Scripts', to: PATHS.scripts, icon: IconCode, permission: PERMISSIONS.scriptsView },
  { label: 'Auditoria', to: PATHS.audit, icon: IconListDetails, permission: PERMISSIONS.auditView },
  {
    label: 'Clientes',
    to: PATHS.clients,
    icon: IconBuilding,
    permission: PERMISSIONS.clientsView,
    children: [
      { label: 'Implantações', to: PATHS.deployments, icon: IconRocket, permission: PERMISSIONS.agentsInstall },
      { label: 'Inventário', to: PATHS.inventory, icon: IconBox, permission: PERMISSIONS.inventoryView },
      { label: 'Rede SNMP', to: PATHS.snmp, icon: IconRouter, permission: PERMISSIONS.snmpView },
      { label: 'Documentação', to: PATHS.docs, icon: IconBook2, permission: PERMISSIONS.docsView },
    ],
  },
  {
    label: 'Configurações',
    to: PATHS.settings,
    icon: IconSettings,
    permission: PERMISSIONS.settingsManage,
    children: [
      { label: 'Chaves de API', to: PATHS.apiKeys, icon: IconKey, permission: PERMISSIONS.apiKeysManage },
      { label: 'Usuários', to: PATHS.users, icon: IconUsers, permission: PERMISSIONS.usersView },
      { label: 'Papéis', to: PATHS.roles, icon: IconShieldLock, permission: PERMISSIONS.rolesManage },
      { label: 'Logs', to: PATHS.logs, icon: IconLogs, permission: PERMISSIONS.logsView },
    ],
  },
];

export interface VisibleNavItem extends Omit<NavItem, 'children'> {
  /** Falso quando o item so aparece como titulo de um grupo com filhos visiveis. */
  allowed: boolean;
  children: VisibleNavItem[];
}

function canSee(me: MeDto | undefined, item: NavItem): boolean {
  return !item.permission || hasPermission(me, item.permission);
}

/** Itens do menu que o usuario pode ver; um grupo aparece se ele ou algum filho for permitido. */
export function visibleNavItems(me: MeDto | undefined): VisibleNavItem[] {
  const result: VisibleNavItem[] = [];
  for (const item of NAV_ITEMS) {
    const children: VisibleNavItem[] = (item.children ?? [])
      .filter((child) => canSee(me, child))
      .map((child) => ({ ...child, allowed: true, children: [] }));
    const allowed = canSee(me, item);
    if (allowed || children.length > 0) result.push({ ...item, allowed, children });
  }
  return result;
}

export function isNavActive(pathname: string, to: string): boolean {
  return to === PATHS.dashboard ? pathname === to : pathname === to || pathname.startsWith(`${to}/`);
}
