import {
  IconBrandApple,
  IconBrandWindows,
  IconCircleCheck,
  IconClockExclamation,
  IconDevicesPc,
  IconPlugConnectedX,
  IconTerminal2,
  type Icon,
} from '@tabler/icons-react';
import type { AgentStatus, MonitoringType } from '../../api/types';

interface StatusInfo {
  label: string;
  color: string;
  icon: Icon;
}

export const STATUS_INFO: Record<AgentStatus, StatusInfo> = {
  online: { label: 'Online', color: 'teal', icon: IconCircleCheck },
  offline: { label: 'Offline', color: 'red', icon: IconPlugConnectedX },
  overdue: { label: 'Em atraso', color: 'orange', icon: IconClockExclamation },
};

export const STATUS_OPTIONS = (Object.keys(STATUS_INFO) as AgentStatus[]).map((value) => ({
  value,
  label: STATUS_INFO[value].label,
}));

export const MONITORING_TYPE_LABEL: Record<MonitoringType, string> = {
  server: 'Servidor',
  workstation: 'Estação',
};

interface PlatformInfo {
  label: string;
  icon: Icon;
}

export function platformInfo(plat: string): PlatformInfo {
  switch (plat) {
    case 'windows':
      return { label: 'Windows', icon: IconBrandWindows };
    case 'linux':
      return { label: 'Linux', icon: IconTerminal2 };
    case 'darwin':
      return { label: 'macOS', icon: IconBrandApple };
    default:
      return { label: plat || 'Desconhecido', icon: IconDevicesPc };
  }
}

/** Usuario logado agora ou, se ninguem, o ultimo que entrou. */
export function loggedUser(agent: { loggedInUsername: string | null; lastLoggedInUser: string | null }): string | null {
  const current = agent.loggedInUsername;
  if (current && current !== 'None') return current;
  return agent.lastLoggedInUser || null;
}
