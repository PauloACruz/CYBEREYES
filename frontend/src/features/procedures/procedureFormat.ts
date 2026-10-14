import {
  IconAppWindow,
  IconCloudDownload,
  IconCode,
  IconDeviceDesktopShare,
  IconFolders,
  IconHeartRateMonitor,
  IconListCheck,
  IconPackage,
  IconPencil,
  IconPower,
  IconPrompt,
  IconRefresh,
  IconBinaryTree,
  IconServer,
  IconTerminal2,
  IconWifi,
  IconX,
  type Icon,
} from '@tabler/icons-react';
import type { ProcedureDto, ProcedureKind, ProcedureStatus } from '../../api/types';
import { formatDuration } from '../../lib/format';

export const PROCEDURE_KIND_INFO: Record<ProcedureKind, { label: string; icon: Icon; color: string }> = {
  remote: { label: 'Acesso remoto', icon: IconDeviceDesktopShare, color: 'blue' },
  files: { label: 'Arquivos', icon: IconFolders, color: 'grape' },
  care: { label: 'Cybereyes Care', icon: IconHeartRateMonitor, color: 'teal' },
  command: { label: 'Comando', icon: IconPrompt, color: 'gray' },
  script: { label: 'Script', icon: IconCode, color: 'violet' },
  terminal: { label: 'Terminal', icon: IconTerminal2, color: 'gray' },
  rename: { label: 'Hostname', icon: IconPencil, color: 'cyan' },
  reboot: { label: 'Reinício', icon: IconRefresh, color: 'orange' },
  shutdown: { label: 'Desligamento', icon: IconPower, color: 'red' },
  service: { label: 'Serviço', icon: IconServer, color: 'indigo' },
  process: { label: 'Processo', icon: IconX, color: 'pink' },
  registry: { label: 'Registro', icon: IconBinaryTree, color: 'yellow' },
  software: { label: 'Software', icon: IconPackage, color: 'lime' },
  updates: { label: 'Atualizações', icon: IconCloudDownload, color: 'blue' },
  task: { label: 'Tarefa', icon: IconListCheck, color: 'gray' },
  wake: { label: 'Wake-on-LAN', icon: IconWifi, color: 'cyan' },
  agent_update: { label: 'Atualização do EYES', icon: IconAppWindow, color: 'gray' },
};

export const PROCEDURE_KINDS = Object.keys(PROCEDURE_KIND_INFO) as ProcedureKind[];

export const PROCEDURE_STATUS_INFO: Record<ProcedureStatus, { label: string; color: string }> = {
  running: { label: 'Em andamento', color: 'blue' },
  ok: { label: 'Concluído', color: 'teal' },
  warning: { label: 'Com avisos', color: 'yellow' },
  error: { label: 'Falhou', color: 'red' },
  cancelled: { label: 'Cancelado', color: 'gray' },
  timeout: { label: 'Sem resposta', color: 'orange' },
};

/** Duracao do procedimento: "–" em andamento (a situacao ja diz), "Não medida" (sem fim registrado) ou o tempo. */
export function procedureDuration(p: Pick<ProcedureDto, 'status' | 'durationSeconds'>): string {
  if (p.status === 'running') return '–';
  return formatDuration(p.durationSeconds, 'Não medida').replace(/^0 s$/, 'menos de 1 s');
}

/** Tempo de servico sugerido ao incluir no chamado: a duracao arredondada para cima, de 1 a 1440 minutos. */
export function suggestedMinutes(p: Pick<ProcedureDto, 'durationSeconds'>): number {
  return Math.min(1440, Math.max(1, Math.ceil((p.durationSeconds ?? 0) / 60)));
}

/** Total em horas e minutos para os indicadores: 5400 -> "1 h 30 min". */
export function formatTotalSeconds(seconds: number): string {
  return formatDuration(seconds, '0 min').replace(/^\d+ s$/, 'menos de 1 min');
}

/** Pode entrar num chamado: ja terminou e ainda nao esta em nenhum. */
export function canInclude(p: Pick<ProcedureDto, 'status' | 'ticketId'>): boolean {
  return p.status !== 'running' && p.ticketId === null;
}
