import type { SpeedTestAnalysis, SpeedTestPhase, SpeedTestSeverity, SpeedTestStatus } from '../../../api/types';

const oneDecimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const twoDecimals = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

/** Velocidade com uma casa abaixo de 100 Mbit/s (como os testes de velocidade costumam mostrar). */
export function formatMbps(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return `${(value >= 100 ? integer : oneDecimal).format(value)} Mbit/s`;
}

export function formatMs(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return `${(value >= 100 ? integer : oneDecimal).format(value)} ms`;
}

export function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return `${twoDecimals.format(value)}%`;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${twoDecimals.format(bytes / 1e9)} GB`;
  if (bytes >= 1e6) return `${oneDecimal.format(bytes / 1e6)} MB`;
  if (bytes >= 1e3) return `${integer.format(bytes / 1e3)} kB`;
  return `${bytes} B`;
}

export const PHASES: { value: SpeedTestPhase; label: string }[] = [
  { value: 'network', label: 'Rede local e Wi-Fi' },
  { value: 'latency', label: 'Latência, perda e DNS' },
  { value: 'download', label: 'Download' },
  { value: 'upload', label: 'Upload' },
  { value: 'finishing', label: 'Relatório' },
];

export const STATUS_INFO: Record<SpeedTestStatus, { label: string; color: string }> = {
  pending: { label: 'Aguardando o agente', color: 'gray' },
  running: { label: 'Medindo', color: 'blue' },
  completed: { label: 'Concluído', color: 'teal' },
  failed: { label: 'Falhou', color: 'red' },
};

export const QUALITY_INFO: Record<SpeedTestAnalysis['quality'], { label: string; color: string }> = {
  excellent: { label: 'Excelente', color: 'teal' },
  good: { label: 'Boa', color: 'green' },
  fair: { label: 'Regular', color: 'orange' },
  poor: { label: 'Ruim', color: 'red' },
};

export const RATING_INFO: Record<'great' | 'good' | 'poor', { label: string; color: string }> = {
  great: { label: 'Ótimo', color: 'teal' },
  good: { label: 'Bom', color: 'yellow' },
  poor: { label: 'Ruim', color: 'red' },
};

export const SEVERITY_INFO: Record<SpeedTestSeverity, { label: string; color: string }> = {
  critical: { label: 'Crítico', color: 'red' },
  warning: { label: 'Atenção', color: 'orange' },
  info: { label: 'Informação', color: 'blue' },
  ok: { label: 'Tudo certo', color: 'teal' },
};

/** Nota de bufferbloat: A+ e A verdes, B amarela, C laranja, D e F vermelhas. */
export function gradeColor(grade: string | null): string {
  if (!grade) return 'gray';
  if (grade.startsWith('A')) return 'teal';
  if (grade === 'B') return 'yellow';
  if (grade === 'C') return 'orange';
  return 'red';
}

export const NETWORK_TYPE_LABEL: Record<string, string> = {
  wifi: 'Wi-Fi',
  ethernet: 'Cabo (Ethernet)',
  other: 'Outra (VPN, virtual ou móvel)',
};
