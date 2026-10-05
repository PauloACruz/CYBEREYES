import { ticketProgress, type StepState } from '../lib/progress';
import type { Ticket } from '../lib/types';

const MARK: Record<StepState, string> = { done: '✓', current: '', attention: '!', pending: '' };

const STATE_TEXT: Record<StepState, string> = {
  done: 'concluído',
  current: 'etapa atual',
  attention: 'aguardando você',
  pending: 'pendente',
};

export function TicketProgress({ ticket }: { ticket: Pick<Ticket, 'status' | 'assignedToName' | 'createdAt'> }) {
  return (
    <ol className="progress" aria-label="Andamento do chamado">
      {ticketProgress(ticket).map((s) => (
        <li key={s.key} className={`progress-step progress-${s.state}`} aria-current={s.current ? 'step' : undefined}>
          <span className="progress-dot" aria-hidden="true">
            {MARK[s.state]}
          </span>
          <span className="progress-label">
            {s.label}
            <span className="sr-only"> ({STATE_TEXT[s.state]})</span>
          </span>
          {s.detail && <span className="progress-detail">{s.detail}</span>}
        </li>
      ))}
    </ol>
  );
}
