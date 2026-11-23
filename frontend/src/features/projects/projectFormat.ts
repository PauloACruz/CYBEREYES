import dayjs from 'dayjs';
import type { ProjectItemStatus, ProjectPhase, ProjectProgress, ProjectRecurrence } from '../../api/projects';

export const PHASE_LABELS: Record<ProjectPhase, string> = {
  scheduled: 'Agendado',
  in_progress: 'Em andamento',
  late: 'Atrasado',
  paused: 'Pausado',
  done: 'Concluído',
  cancelled: 'Cancelado',
};

export const PHASE_COLORS: Record<ProjectPhase, string> = {
  scheduled: 'indigo',
  in_progress: 'blue',
  late: 'red',
  paused: 'yellow',
  done: 'teal',
  cancelled: 'gray',
};

export const ITEM_STATUS_LABELS: Record<ProjectItemStatus, string> = {
  pending: 'Pendente',
  in_progress: 'Em andamento',
  done: 'Concluída',
  problem: 'Com problema',
  skipped: 'Não se aplica',
};

export const ITEM_STATUS_COLORS: Record<ProjectItemStatus, string> = {
  pending: 'gray',
  in_progress: 'blue',
  done: 'teal',
  problem: 'red',
  skipped: 'dark',
};

export const ITEM_STATUS_OPTIONS = (Object.keys(ITEM_STATUS_LABELS) as ProjectItemStatus[]).map((value) => ({
  value,
  label: ITEM_STATUS_LABELS[value],
}));

const UNITS: Record<Exclude<ProjectRecurrence, 'none'>, [string, string]> = {
  daily: ['dia', 'dias'],
  weekly: ['semana', 'semanas'],
  monthly: ['mês', 'meses'],
  yearly: ['ano', 'anos'],
};

export const RECURRENCE_OPTIONS: { value: ProjectRecurrence; label: string }[] = [
  { value: 'none', label: 'Não se repete' },
  { value: 'daily', label: 'Diária' },
  { value: 'weekly', label: 'Semanal' },
  { value: 'monthly', label: 'Mensal' },
  { value: 'yearly', label: 'Anual' },
];

/** "Não se repete", "Todo mês", "A cada 6 meses"... */
export function recurrenceLabel(recurrence: ProjectRecurrence, interval: number): string {
  if (recurrence === 'none') return 'Não se repete';
  const [one, many] = UNITS[recurrence];
  if (interval <= 1) return recurrence === 'weekly' ? 'Toda semana' : `Todo ${one}`;
  return `A cada ${interval} ${many}`;
}

export function recurrenceUnit(recurrence: ProjectRecurrence, interval: number): string {
  if (recurrence === 'none') return '';
  const [one, many] = UNITS[recurrence];
  return interval === 1 ? one : many;
}

export function formatDay(value: string | null | undefined, empty = '—'): string {
  return value ? dayjs(value).format('DD/MM/YYYY') : empty;
}

/** "01/03 a 10/03/2030", "a partir de 01/03/2030", "até 10/03/2030" ou vazio. */
export function periodLabel(start: string | null, due: string | null): string {
  if (start && due) {
    const s = dayjs(start);
    const d = dayjs(due);
    return `${s.format(s.year() === d.year() ? 'DD/MM' : 'DD/MM/YYYY')} a ${d.format('DD/MM/YYYY')}`;
  }
  if (start) return `a partir de ${formatDay(start)}`;
  if (due) return `até ${formatDay(due)}`;
  return 'Sem datas';
}

/** Itens encerrados (concluídos ou que não se aplicam) sobre o total, em porcentagem inteira. */
export function progressPercent(progress: ProjectProgress): number {
  const total = progress.agentsTotal + progress.tasksTotal;
  if (total === 0) return 0;
  return Math.round(((progress.agentsFinished + progress.tasksFinished) * 100) / total);
}

export function isFinished(status: ProjectItemStatus): boolean {
  return status === 'done' || status === 'skipped';
}
