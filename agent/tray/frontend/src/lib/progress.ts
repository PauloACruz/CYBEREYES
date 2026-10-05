import { formatDateTime } from './format';
import type { Ticket } from './types';

/** done: etapa cumprida; current: em curso; attention: depende do usuario; pending: ainda nao chegou. */
export type StepState = 'done' | 'current' | 'attention' | 'pending';

export interface ProgressStep {
  key: 'opened' | 'attending' | 'finished';
  label: string;
  detail: string;
  state: StepState;
  /** Etapa que representa o status atual (aria-current="step"). */
  current: boolean;
}

/**
 * Etapas do andamento mostradas ao usuario: aberto, atendimento e conclusao.
 * Usa so os campos que o app recebe da API (status, tecnico e data de abertura).
 */
export function ticketProgress(t: Pick<Ticket, 'status' | 'assignedToName' | 'createdAt'>): ProgressStep[] {
  const tech = t.assignedToName;
  const finished = t.status === 'resolved' || t.status === 'closed';

  let attending: Pick<ProgressStep, 'detail' | 'state'>;
  switch (t.status) {
    case 'new':
      attending = { state: 'current', detail: tech ?? 'Aguardando um técnico' };
      break;
    case 'in_progress':
      attending = { state: 'current', detail: tech ?? 'Técnico trabalhando no chamado' };
      break;
    case 'waiting_user':
      attending = { state: 'attention', detail: 'Aguardando sua resposta' };
      break;
    default:
      attending = { state: 'done', detail: tech ?? '' };
  }

  return [
    { key: 'opened', label: 'Aberto', detail: formatDateTime(t.createdAt), state: 'done', current: false },
    { key: 'attending', label: 'Em atendimento', ...attending, current: !finished },
    {
      key: 'finished',
      label: t.status === 'closed' ? 'Encerrado' : 'Resolvido',
      detail: t.status === 'resolved' ? 'Responda se o problema voltar' : '',
      state: finished ? 'done' : 'pending',
      current: finished,
    },
  ];
}
