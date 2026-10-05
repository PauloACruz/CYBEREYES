import type { CareCatalog, CareLogLevel, CareRunStatus, CareTaskStatus, HealthGrade, HealthItemStatus } from '../../api/types';

/**
 * Nome visivel do modulo de manutencao. Fixo por escolha do usuario: nao acompanha o
 * branding configuravel. Use esta constante em todo texto do modulo exibido na tela.
 */
export const CARE_NAME = 'Cybereyes Care';

export const RUN_STATUS_LABEL: Record<CareRunStatus, string> = {
  running: 'Em execução',
  ok: 'Concluído',
  warning: 'Concluído com avisos',
  error: 'Falhou',
  cancelled: 'Cancelado',
  timeout: 'Tempo esgotado',
};

export const RUN_STATUS_COLOR: Record<CareRunStatus, string> = {
  running: 'blue',
  ok: 'teal',
  warning: 'orange',
  error: 'red',
  cancelled: 'gray',
  timeout: 'red',
};

export const TASK_STATUS_LABEL: Record<CareTaskStatus, string> = {
  running: 'Executando',
  ok: 'OK',
  warning: 'Aviso',
  error: 'Erro',
  skipped: 'Ignorada',
};

export const LOG_LEVEL_COLOR: Record<CareLogLevel, string> = {
  INFO: 'var(--mantine-color-gray-3)',
  WARN: 'var(--mantine-color-yellow-4)',
  ERROR: 'var(--mantine-color-red-4)',
  SUCCESS: 'var(--mantine-color-green-4)',
};

export const HEALTH_GRADE_INFO: Record<HealthGrade, { label: string; color: string }> = {
  otimo: { label: 'Ótimo', color: 'green' },
  bom: { label: 'Bom', color: 'blue' },
  atencao: { label: 'Atenção', color: 'orange' },
  critico: { label: 'Crítico', color: 'red' },
};

export const HEALTH_ITEM_INFO: Record<HealthItemStatus, { label: string; color: string }> = {
  ok: { label: 'OK', color: 'teal' },
  warning: { label: 'Atenção', color: 'orange' },
  critical: { label: 'Crítico', color: 'red' },
  unknown: { label: 'Não se aplica', color: 'gray' },
};

export const AGENT_NO_RESPONSE = 'Agente sem resposta';
export const AGENT_BUSY_MESSAGE = 'Já existe uma execução em andamento nesta máquina';

export function moduleLabel(catalog: CareCatalog | undefined, moduleKey: string): string {
  return catalog?.modules.find((m) => m.key === moduleKey)?.label ?? moduleKey;
}

export function taskLabel(catalog: CareCatalog | undefined, moduleKey: string, taskKey: string): string {
  return catalog?.modules.find((m) => m.key === moduleKey)?.tasks.find((t) => t.key === taskKey)?.label ?? taskKey;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds} s`;
  const hours = Math.floor(minutes / 60);
  if (hours === 0) return `${minutes} min ${seconds} s`;
  return `${hours} h ${minutes % 60} min`;
}
