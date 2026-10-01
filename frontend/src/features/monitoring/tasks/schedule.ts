import type { TaskDto } from '../../../api/types';
import { formatDateTime } from '../../../lib/format';
import { WEEKDAYS } from '../monitoringFormat';

/** "a", "a e b", "a, b e c". */
export function joinPt(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1] ?? ''}`;
}

type ScheduleFields = Pick<TaskDto, 'scheduleType' | 'runAt' | 'time' | 'daysOfWeek' | 'dayOfMonth' | 'assignedCheckId'>;

/** Agendamento em portugues legivel, ex.: "Toda semana na segunda-feira e na quarta-feira, às 08:00". */
export function describeSchedule(task: ScheduleFields, checkName?: string): string {
  const at = task.time ? ` às ${task.time}` : '';
  switch (task.scheduleType) {
    case 'manual':
      return 'Somente manual';
    case 'once':
      return task.runAt ? `Uma vez, em ${formatDateTime(task.runAt)}` : 'Uma vez (data não definida)';
    case 'daily':
      return `Todos os dias${at}`;
    case 'weekly': {
      const days = [...new Set(task.daysOfWeek)].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
      if (days.length === 7) return `Todos os dias${at}`;
      if (days.length === 5 && days.every((d, i) => d === i + 1)) return `De segunda a sexta-feira${at}`;
      if (days.length === 2 && days[0] === 0 && days[1] === 6) return `Aos sábados e domingos${at}`;
      if (days.length === 0) return 'Toda semana (nenhum dia escolhido)';
      const names = days.map((d) => `${d === 0 || d === 6 ? 'no' : 'na'} ${WEEKDAYS[d]?.long ?? String(d)}`);
      return `Toda semana ${joinPt(names)},${at}`;
    }
    case 'monthly':
      return `Todo dia ${task.dayOfMonth ?? '?'} do mês${at}`;
    case 'check_failure':
      return checkName ? `Quando o check ${checkName} falhar` : 'Quando o check associado falhar';
  }
}
