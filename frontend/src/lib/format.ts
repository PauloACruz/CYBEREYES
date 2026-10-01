const dateTimeFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });

export function formatDateTime(value: string | null | undefined, empty = 'Nunca'): string {
  if (!value) return empty;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateTimeFormat.format(date);
}

export function formatDate(value: string | null | undefined, empty = 'Sem validade'): string {
  if (!value) return empty;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateFormat.format(date);
}

export function totalPages(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

const relativeFormat = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
const RELATIVE_STEPS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['second', 60],
  ['minute', 60],
  ['hour', 24],
  ['day', 30],
  ['month', 12],
  ['year', Number.POSITIVE_INFINITY],
];

/** "há 5 minutos", "ontem"... */
export function formatRelative(value: string | null | undefined, now: number = Date.now(), empty = 'Nunca'): string {
  if (!value) return empty;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return value;
  let amount = (time - now) / 1000;
  for (const [unit, size] of RELATIVE_STEPS) {
    if (Math.abs(amount) < size) {
      if (unit === 'second' && Math.abs(amount) < 30) return 'agora';
      return relativeFormat.format(Math.round(amount), unit);
    }
    amount /= size;
  }
  return relativeFormat.format(Math.round(amount), 'year');
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
const numberFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

/** 1536 -> "1,5 KB" (base 1024). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${numberFormat.format(value)} ${BYTE_UNITS[unit] ?? 'B'}`;
}

export function formatSeconds(seconds: number): string {
  return `${numberFormat.format(seconds)} s`;
}

const BPS_UNITS = ['bps', 'kbps', 'Mbps', 'Gbps', 'Tbps'] as const;

/** Taxa em bits por segundo (base 1000): 1500 -> "1,5 kbps"; nulo ou invalido -> vazio. */
export function formatBitsPerSecond(bps: number | null | undefined, empty = 'Sem dados'): string {
  if (bps === null || bps === undefined || !Number.isFinite(bps) || bps < 0) return empty;
  let value = bps;
  let unit = 0;
  while (value >= 1000 && unit < BPS_UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${numberFormat.format(value)} ${BPS_UNITS[unit] ?? 'bps'}`;
}

/** Duracao humanizada: 93784 -> "1 d 2 h", 3720 -> "1 h 2 min", 30 -> "menos de 1 min". */
export function formatDuration(seconds: number | null | undefined, empty = 'Não informado'): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return empty;
  const total = Math.floor(seconds);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  if (days > 0) return hours > 0 ? `${days} d ${hours} h` : `${days} d`;
  if (hours > 0) return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
  if (minutes > 0) return `${minutes} min`;
  return 'menos de 1 min';
}

const integerFormat = new Intl.NumberFormat('pt-BR');

export function formatInteger(value: number): string {
  return integerFormat.format(value);
}
