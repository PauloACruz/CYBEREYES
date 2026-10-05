import { IconAlertTriangle, IconCircleX, IconFlame, IconInfoCircle } from '@tabler/icons-react';
import dayjs from 'dayjs';
import type { LogCollectLevel, LogLevel, LogSummaryDto } from '../../api/types';
import type { StackBucket } from '../../components/charts/StackedBarChart';
import type { DisplayInfo } from '../monitoring/monitoringFormat';

/** Do mais grave para o menos grave (ordem de empilhamento no grafico, da base para o topo). */
export const LOG_LEVELS: readonly LogLevel[] = ['critical', 'error', 'warning', 'info'];

export interface LogLevelInfo extends DisplayInfo {
  /** Cor da serie no grafico (charts.css). */
  chartColor: string;
  variant: 'filled' | 'light';
}

export const LOG_LEVEL_INFO: Record<LogLevel, LogLevelInfo> = {
  critical: { label: 'Crítico', color: 'red', variant: 'filled', icon: IconFlame, chartColor: 'var(--ce-log-critical)' },
  error: { label: 'Erro', color: 'red', variant: 'light', icon: IconCircleX, chartColor: 'var(--ce-log-error)' },
  warning: { label: 'Aviso', color: 'orange', variant: 'light', icon: IconAlertTriangle, chartColor: 'var(--ce-log-warning)' },
  info: { label: 'Informação', color: 'blue', variant: 'light', icon: IconInfoCircle, chartColor: 'var(--ce-log-info)' },
};

export const LOG_LEVEL_OPTIONS = LOG_LEVELS.map((value) => ({ value, label: LOG_LEVEL_INFO[value].label }));

export const LOG_COLLECT_LEVEL_OPTIONS: { value: LogCollectLevel; label: string }[] = [
  { value: 'error', label: 'Erro' },
  { value: 'warning', label: 'Aviso' },
  { value: 'info', label: 'Informação' },
];

export function isLogLevel(value: string | null | undefined): value is LogLevel {
  return value === 'critical' || value === 'error' || value === 'warning' || value === 'info';
}

export function isLogCollectLevel(value: string | null | undefined): value is LogCollectLevel {
  return value === 'error' || value === 'warning' || value === 'info';
}

export type PeriodPreset = '1h' | '24h' | '7d' | 'custom';

export const PERIOD_OPTIONS: { value: PeriodPreset; label: string }[] = [
  { value: '1h', label: '1 h' },
  { value: '24h', label: '24 h' },
  { value: '7d', label: '7 dias' },
  { value: 'custom', label: 'Personalizado' },
];

const PRESET_HOURS: Record<Exclude<PeriodPreset, 'custom'>, number> = { '1h': 1, '24h': 24, '7d': 168 };

export function isPeriodPreset(value: string): value is PeriodPreset {
  return value === '1h' || value === '24h' || value === '7d' || value === 'custom';
}

export const MAX_RANGE_DAYS = 31;

export type DayRange = [string | null, string | null];

export interface ResolvedPeriod {
  from?: string;
  to?: string;
  /** Mensagem de erro quando o intervalo personalizado e invalido (consulta nao e feita). */
  error?: string;
}

/** Converte o periodo escolhido em from/to (ISO). Os atalhos sao relativos ao instante "anchor". */
export function resolvePeriod(preset: PeriodPreset, range: DayRange, anchor: number): ResolvedPeriod {
  if (preset !== 'custom') {
    const hours = PRESET_HOURS[preset];
    return { from: new Date(anchor - hours * 3_600_000).toISOString(), to: new Date(anchor).toISOString() };
  }
  const [start, end] = range;
  if (!start) return { error: 'Escolha o intervalo.' };
  const from = dayjs(start).startOf('day');
  const to = dayjs(end ?? start).endOf('day');
  if (to.diff(from, 'day', true) > MAX_RANGE_DAYS) return { error: `O intervalo máximo é de ${MAX_RANGE_DAYS} dias.` };
  return { from: from.toISOString(), to: to.toISOString() };
}

const logTimeFormat = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export function formatLogTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : logTimeFormat.format(date);
}

const HOUR_MS = 3_600_000;
const MAX_HOURS = 31 * 24 + 1;

/** O servidor so devolve horas com eventos; completa as horas vazias do periodo para o eixo de tempo ficar continuo. */
export function fillHours(perHour: LogSummaryDto['perHour'], from?: string, to?: string): StackBucket<LogLevel>[] {
  const known = new Map(perHour.map((h) => [new Date(h.hour).getTime(), h]));
  const toBucket = (time: number): StackBucket<LogLevel> => {
    const h = known.get(time);
    return {
      time: new Date(time).toISOString(),
      values: { critical: h?.critical ?? 0, error: h?.error ?? 0, warning: h?.warning ?? 0, info: h?.info ?? 0 },
    };
  };
  const times = [...known.keys()].sort((a, b) => a - b);
  const start = from ? Math.floor(new Date(from).getTime() / HOUR_MS) * HOUR_MS : times[0];
  const end = to ? Math.floor(new Date(to).getTime() / HOUR_MS) * HOUR_MS : times[times.length - 1];
  if (start === undefined || end === undefined || Number.isNaN(start) || Number.isNaN(end) || end < start || (end - start) / HOUR_MS > MAX_HOURS) {
    return times.map(toBucket);
  }
  const buckets: StackBucket<LogLevel>[] = [];
  for (let t = start; t <= end; t += HOUR_MS) buckets.push(toBucket(t));
  return buckets;
}
