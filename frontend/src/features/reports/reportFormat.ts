import dayjs from 'dayjs';
import type {
  ReportColumnKind,
  ReportFilterKey,
  ReportFormat,
  ReportFrequency,
  ReportParams,
  ReportPeriod,
  ReportScheduleDto,
  ReportType,
  ReportTypeDto,
} from '../../api/types';
import { formatDateTime, formatDuration } from '../../lib/format';
import { STATUS_OPTIONS as AGENT_STATUS_OPTIONS } from '../agents/agentFormat';
import { WEEKDAYS } from '../monitoring/monitoringFormat';
import { STATUS_OPTIONS as TICKET_STATUS_OPTIONS } from '../tickets/ticketFormat';

export const REPORT_PERIODS: readonly ReportPeriod[] = ['last_24h', 'last_7d', 'last_30d', 'previous_month', 'current_month'];

export const REPORT_PERIOD_LABEL: Record<ReportPeriod, string> = {
  last_24h: 'Últimas 24 horas',
  last_7d: 'Últimos 7 dias',
  last_30d: 'Últimos 30 dias',
  previous_month: 'Mês anterior',
  current_month: 'Mês atual',
};

export type PeriodChoice = ReportPeriod | 'custom';

export const PERIOD_OPTIONS: { value: ReportPeriod; label: string }[] = REPORT_PERIODS.map((value) => ({
  value,
  label: REPORT_PERIOD_LABEL[value],
}));

export const PERIOD_CHOICE_OPTIONS: { value: PeriodChoice; label: string }[] = [...PERIOD_OPTIONS, { value: 'custom', label: 'Personalizado' }];

export const DEFAULT_PERIOD: ReportPeriod = 'last_7d';
export const MAX_REPORT_RANGE_DAYS = 366;

export function isReportPeriod(value: string | null | undefined): value is ReportPeriod {
  return value !== null && value !== undefined && (REPORT_PERIODS as readonly string[]).includes(value);
}

export function isPeriodChoice(value: string | null | undefined): value is PeriodChoice {
  return value === 'custom' || isReportPeriod(value);
}

export const FORMAT_LABEL: Record<ReportFormat, string> = { pdf: 'PDF', csv: 'CSV' };

export function isReportFormat(value: string | null | undefined): value is ReportFormat {
  return value === 'pdf' || value === 'csv';
}

export const FREQUENCY_OPTIONS: { value: ReportFrequency; label: string }[] = [
  { value: 'daily', label: 'Diária' },
  { value: 'weekly', label: 'Semanal' },
  { value: 'monthly', label: 'Mensal' },
];

export function isReportFrequency(value: string | null | undefined): value is ReportFrequency {
  return value === 'daily' || value === 'weekly' || value === 'monthly';
}

/** "Diária às 08:00", "Semanal, segunda-feira às 08:00", "Mensal, dia 5 às 08:00". */
export function describeSchedule(schedule: Pick<ReportScheduleDto, 'frequency' | 'time' | 'dayOfWeek' | 'dayOfMonth'>): string {
  switch (schedule.frequency) {
    case 'daily':
      return `Diária às ${schedule.time}`;
    case 'weekly': {
      const day = WEEKDAYS.find((d) => d.value === schedule.dayOfWeek);
      return `Semanal, ${day?.long ?? 'dia não definido'} às ${schedule.time}`;
    }
    case 'monthly':
      return `Mensal, dia ${schedule.dayOfMonth ?? '?'} às ${schedule.time}`;
  }
}

export function hasFilter(def: ReportTypeDto | undefined, key: ReportFilterKey): boolean {
  return def?.filters.includes(key) ?? false;
}

/** Opcoes do filtro de status conforme o tipo; null quando o tipo nao tem lista conhecida. */
export function statusOptionsFor(type: ReportType): { value: string; label: string }[] | null {
  if (type === 'agents') return AGENT_STATUS_OPTIONS;
  if (type === 'tickets') return TICKET_STATUS_OPTIONS;
  return null;
}

export type DayRange = [string | null, string | null];

/** Estado dos filtros na tela (strings vindas dos campos). */
export interface ReportFilterValues {
  clientId: string | null;
  siteId: string | null;
  status: string | null;
  severity: string | null;
  assignedToId: string | null;
  assetType: string | null;
  onlyPending: boolean;
  maxScore: number | string;
  period: PeriodChoice;
  range: DayRange;
}

export const EMPTY_FILTERS: ReportFilterValues = {
  clientId: null,
  siteId: null,
  status: null,
  severity: null,
  assignedToId: null,
  assetType: null,
  onlyPending: false,
  maxScore: '',
  period: DEFAULT_PERIOD,
  range: [null, null],
};

function toId(value: string | null): number | undefined {
  if (!value) return undefined;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

export interface BuiltParams {
  params: ReportParams;
  /** Problema que impede a consulta (ex.: intervalo invalido). */
  error?: string;
}

/** Monta os ReportParams enviando so os filtros que o tipo usa. */
export function buildReportParams(def: ReportTypeDto, values: ReportFilterValues): BuiltParams {
  const params: ReportParams = { type: def.type };
  const uses = (key: ReportFilterKey) => hasFilter(def, key);
  if (uses('clientId')) params.clientId = toId(values.clientId);
  if (uses('siteId')) params.siteId = toId(values.siteId);
  if (uses('status') && values.status) params.status = values.status;
  if (uses('severity') && values.severity) params.severity = values.severity;
  if (uses('assignedToId') && values.assignedToId) params.assignedToId = values.assignedToId;
  if (uses('assetType') && values.assetType) params.assetType = values.assetType;
  if (uses('onlyPending') && values.onlyPending) params.onlyPending = true;
  if (uses('maxScore') && values.maxScore !== '' && Number.isFinite(Number(values.maxScore))) params.maxScore = Number(values.maxScore);

  if (!def.usesPeriod) return { params };
  if (values.period !== 'custom') {
    params.period = values.period;
    return { params };
  }
  const [start, end] = values.range;
  if (!start) return { params, error: 'Escolha o intervalo de datas.' };
  const from = dayjs(start).startOf('day');
  const to = dayjs(end ?? start).endOf('day');
  if (to.diff(from, 'day', true) > MAX_REPORT_RANGE_DAYS) {
    return { params, error: `O intervalo máximo é de ${MAX_REPORT_RANGE_DAYS} dias.` };
  }
  params.from = from.toISOString();
  params.to = to.toISOString();
  return { params };
}

/** Converte os ReportParams salvos de volta para o estado dos filtros. */
export function filtersFromParams(params: ReportParams): ReportFilterValues {
  return {
    clientId: params.clientId ? String(params.clientId) : null,
    siteId: params.siteId ? String(params.siteId) : null,
    status: params.status ?? null,
    severity: params.severity ?? null,
    assignedToId: params.assignedToId ?? null,
    assetType: params.assetType ?? null,
    onlyPending: params.onlyPending ?? false,
    maxScore: params.maxScore ?? '',
    period: params.period ?? DEFAULT_PERIOD,
    range: [null, null],
  };
}

const numberFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const percentFormat = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 2 });
const dateOnlyFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return value.toString();
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return '';
}

function formatDateValue(value: string): string {
  // Data pura (sem hora) nao passa por fuso: "2026-10-01" seria o dia anterior no Brasil.
  const match = DATE_ONLY_RE.exec(value);
  if (match) return `${match[3] ?? ''}/${match[2] ?? ''}/${match[1] ?? ''}`;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateOnlyFormat.format(date);
}

/**
 * Formata uma celula pelo kind da coluna. Datas no fuso do navegador; percent recebe o valor
 * em pontos percentuais (99,5 = 99,5%); duration recebe segundos.
 */
export function formatReportCell(value: unknown, kind: ReportColumnKind): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  switch (kind) {
    case 'number': {
      const n = asNumber(value);
      return n === null ? textOf(value) : numberFormat.format(n);
    }
    case 'percent': {
      const n = asNumber(value);
      return n === null ? textOf(value) : percentFormat.format(n / 100);
    }
    case 'duration': {
      const n = asNumber(value);
      return n === null ? textOf(value) : formatDuration(n, '');
    }
    case 'date':
      return typeof value === 'string' ? formatDateValue(value) : textOf(value);
    case 'datetime':
      return typeof value === 'string' ? formatDateTime(value, '') : textOf(value);
    case 'text':
      return textOf(value);
  }
}

export function isNumericKind(kind: ReportColumnKind): boolean {
  return kind === 'number' || kind === 'percent' || kind === 'duration';
}

export function formatSummaryValue(value: string | number | null): string {
  if (value === null) return '';
  return typeof value === 'number' ? numberFormat.format(value) : value;
}

/** Periodo do relatorio gerado: "01/09/2026 00:00 a 30/09/2026 23:59". */
export function formatReportPeriod(from: string | null | undefined, to: string | null | undefined): string | null {
  if (!from && !to) return null;
  return `${formatDateTime(from, 'início')} a ${formatDateTime(to, 'agora')}`;
}
