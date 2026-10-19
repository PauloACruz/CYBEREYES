import type { InsightSeverity, LogInsightDetailDto, LogInsightItem, LogInsightMachine, TicketPriority } from '../../../api/types';
import { PATHS } from '../../../app/paths';
import { formatDateTime } from '../../../lib/format';

/** Variacao em relacao a janela anterior do mesmo tamanho. */
export function trendLabel(count: number, previous: number): { text: string; up: boolean | null } {
  if (previous === 0) return { text: 'novo no período', up: true };
  const change = Math.round(((count - previous) / previous) * 100);
  if (change === 0) return { text: 'estável', up: null };
  return { text: `${change > 0 ? '+' : ''}${change}% em relação ao período anterior`, up: change > 0 };
}

export const INCIDENT_PRIORITY: Record<InsightSeverity, TicketPriority> = {
  critica: 'critical',
  alta: 'high',
  media: 'medium',
  baixa: 'low',
};

/** "Cliente / Site", ou o que houver dos dois. */
export function machinePlace(machine: LogInsightMachine): string {
  return [machine.client, machine.site].filter(Boolean).join(' / ');
}

/** Link da analise na tela de logs, o mesmo do aviso por push. */
export function insightUrl(reportId: number): string {
  return `${window.location.origin}${PATHS.logs}?aba=analises&analise=${reportId}`;
}

const MAX_DESCRIPTION = 20000;

/** Descricao do incidente: o erro, a recorrencia e o que a IA disse dele, com o link para a analise completa. */
export function incidentDescription(report: Pick<LogInsightDetailDto, 'id' | 'windowStart' | 'windowEnd'>, item: LogInsightItem, machine: LogInsightMachine): string {
  const place = machinePlace(machine);
  const lines = [
    `Erro recorrente apontado pela análise de logs da IA (${formatDateTime(report.windowStart)} a ${formatDateTime(report.windowEnd)}).`,
    '',
    `Máquina: ${machine.hostname}${place ? ` (${place})` : ''}`,
    `Origem: ${item.source}${item.eventId !== null ? ` · evento ${item.eventId}` : ''} · ${item.level}`,
    `Recorrência: ${item.count} ocorrência(s) no período e ${item.previousCount} no anterior, em ${item.days} de 7 dias, ${item.agents} máquina(s) com o erro.`,
    '',
    'Mensagem de exemplo:',
    item.sample,
  ];
  if (item.officialDescription) lines.push('', `Descrição oficial: ${item.officialDescription}`);
  if (item.probableCause) lines.push('', `Causa provável: ${item.probableCause}`);
  if (item.resolution.length > 0) lines.push('', 'Possível resolução:', ...item.resolution.map((step, i) => `${i + 1}. ${step}`));
  if (item.platformActions.length > 0) lines.push('', 'Na plataforma:', ...item.platformActions.map((action) => `- ${action}`));
  lines.push('', `Análise completa: ${insightUrl(report.id)}`);
  const text = lines.join('\n');
  return text.length <= MAX_DESCRIPTION ? text : `${text.slice(0, MAX_DESCRIPTION - 1)}…`;
}
