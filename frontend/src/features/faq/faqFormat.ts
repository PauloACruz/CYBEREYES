import type { FaqEntryDto, FaqSource } from '../../api/types';

export const GUIDE_TAG = 'orientar';

export const SOURCE_LABEL: Record<FaqSource, string> = {
  team: 'Equipe',
  assistant: 'Assistente de IA',
  requester: 'Usuário do app',
};

export const SOURCE_COLOR: Record<FaqSource, string> = {
  team: 'gray',
  assistant: 'teal',
  requester: 'blue',
};

/** "80% acharam útil (5 avaliações)", ou nulo sem avaliações. */
export function helpfulLabel(entry: Pick<FaqEntryDto, 'helpfulCount' | 'notHelpfulCount'>): string | null {
  const total = entry.helpfulCount + entry.notHelpfulCount;
  if (total === 0) return null;
  const rate = Math.round((entry.helpfulCount * 100) / total);
  return `${rate}% acharam útil (${total} ${total === 1 ? 'avaliação' : 'avaliações'})`;
}

/** Métricas de consumo da entrada, em uma linha. */
export function usageLabel(entry: Pick<FaqEntryDto, 'views' | 'usedCount' | 'helpfulCount' | 'notHelpfulCount'>): string {
  const parts = [
    entry.views === 1 ? '1 abertura no app' : `${entry.views} aberturas no app`,
    entry.usedCount === 1 ? 'usada 1 vez nos chamados' : `usada ${entry.usedCount} vezes nos chamados`,
  ];
  const helpful = helpfulLabel(entry);
  if (helpful) parts.push(helpful);
  return parts.join(' · ');
}

/** Passos numerados, um por linha, para o rascunho de uma entrada. */
export function numberedSteps(steps: string[]): string {
  return steps.map((step, i) => `${i + 1}. ${step.trim()}`).join('\n');
}
