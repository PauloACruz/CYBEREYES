import { formatDateTime, isOpen } from '../lib/format';
import type { Ticket } from '../lib/types';
import { StatusBadge } from './StatusBadge';

interface Props {
  tickets: Ticket[];
  unread: ReadonlySet<number>;
  loading: boolean;
  error: string;
  onOpen: (id: number) => void;
  onNew: () => void;
}

export function TicketList({ tickets, unread, loading, error, onOpen, onNew }: Props) {
  const open = tickets.filter((t) => isOpen(t.status));
  const finished = tickets.filter((t) => !isOpen(t.status));

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Meus chamados</h2>
        <button type="button" className="btn btn-primary" onClick={onNew}>
          Abrir chamado
        </button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {loading && tickets.length === 0 && <p className="muted center">Carregando...</p>}
      {!loading && !error && tickets.length === 0 && (
        <div className="empty">
          <p>Você ainda não abriu nenhum chamado nesta máquina.</p>
          <p className="muted">Precisa de ajuda? Clique em "Abrir chamado".</p>
        </div>
      )}
      {tickets.length > 0 && (
        <TicketSection
          id="tickets-open"
          title="Em andamento"
          tickets={open}
          unread={unread}
          onOpen={onOpen}
          empty="Nenhum chamado em andamento."
        />
      )}
      {finished.length > 0 && (
        <TicketSection id="tickets-finished" title="Encerrados" tickets={finished} unread={unread} onOpen={onOpen} empty="" />
      )}
    </section>
  );
}

interface SectionProps {
  id: string;
  title: string;
  tickets: Ticket[];
  unread: ReadonlySet<number>;
  onOpen: (id: number) => void;
  empty: string;
}

function TicketSection({ id, title, tickets, unread, onOpen, empty }: SectionProps) {
  return (
    <section className="ticket-section" aria-labelledby={id}>
      <h3 id={id} className="section-title">
        {title} <span className="section-count">({tickets.length})</span>
      </h3>
      {tickets.length === 0 ? (
        <p className="muted small">{empty}</p>
      ) : (
        <ul className="ticket-list">
          {tickets.map((t) => {
            const isUnread = unread.has(t.id);
            return (
              <li key={t.id}>
                <button type="button" className={`ticket-row${isUnread ? ' unread' : ''}`} onClick={() => { onOpen(t.id); }}>
                  <div className="ticket-row-top">
                    <span className="ticket-number">#{t.id}</span>
                    <StatusBadge status={t.status} />
                    {isUnread && (
                      <span className="new-dot" aria-label="Mensagem nova" title="Mensagem nova" />
                    )}
                  </div>
                  <div className="ticket-title">{t.title}</div>
                  <div className="ticket-meta muted">
                    <span>{t.assignedToName ?? 'Aguardando técnico'}</span>
                    <span>{formatDateTime(t.updatedAt)}</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
