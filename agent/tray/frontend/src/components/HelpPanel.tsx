import { useEffect, useState } from 'react';
import { errorMessage, useBackend } from '../lib/backend';
import type { TicketDraft } from '../lib/selfService';
import type { FaqEntry, FaqList } from '../lib/types';

interface Props {
  /** A resposta não resolveu (ou não há resposta): abre um chamado, preenchido quando há o que preencher. */
  onOpenTicket: (draft?: TicketDraft) => void;
}

const SEARCH_DELAY_MS = 300;

/** Ajuda do app: perguntas frequentes publicadas pela equipe, avaliação da resposta e envio de perguntas novas. */
export function HelpPanel({ onOpenTicket }: Props) {
  const [openId, setOpenId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');

  if (openId !== null) {
    return <HelpEntry id={openId} onBack={() => { setOpenId(null); }} onOpenTicket={onOpenTicket} />;
  }
  return (
    <HelpList
      search={search}
      category={category}
      onSearch={setSearch}
      onCategory={setCategory}
      onOpen={setOpenId}
      onOpenTicket={onOpenTicket}
    />
  );
}

interface ListProps {
  search: string;
  category: string;
  onSearch: (value: string) => void;
  onCategory: (value: string) => void;
  onOpen: (id: number) => void;
  onOpenTicket: (draft?: TicketDraft) => void;
}

function HelpList({ search, category, onSearch, onCategory, onOpen, onOpenTicket }: ListProps) {
  const backend = useBackend();
  const [list, setList] = useState<FaqList | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      backend.listFaq(search, category).then(
        (l) => {
          if (!alive) return;
          setList(l);
          setError('');
        },
        (e: unknown) => {
          if (alive) setError(errorMessage(e));
        },
      );
    }, SEARCH_DELAY_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [backend, search, category]);

  const filtering = search.trim() !== '' || category !== '';

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Ajuda</h2>
      </div>
      <p className="ss-intro muted">Respostas da equipe de suporte para os problemas mais comuns. Tente aqui antes de abrir um chamado.</p>
      <input
        type="search"
        className="help-search"
        placeholder="Descreva o problema, por exemplo: impressora"
        aria-label="Buscar na ajuda"
        value={search}
        maxLength={200}
        onChange={(e) => { onSearch(e.target.value); }}
      />
      {list && list.categories.length > 0 && (
        <div className="help-chips" role="group" aria-label="Categorias">
          <button type="button" className={`chip${category === '' ? ' chip-active' : ''}`} aria-pressed={category === ''} onClick={() => { onCategory(''); }}>
            Todas
          </button>
          {list.categories.map((c) => (
            <button
              key={c}
              type="button"
              className={`chip${category === c ? ' chip-active' : ''}`}
              aria-pressed={category === c}
              onClick={() => { onCategory(c); }}
            >
              {c}
            </button>
          ))}
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {!list && !error && <p className="muted center">Carregando...</p>}
      {list && list.entries.length === 0 && (
        <p className="muted center">{filtering ? 'Nenhuma resposta encontrada.' : 'Ainda não há perguntas publicadas.'}</p>
      )}
      {list && list.entries.length > 0 && (
        <ul className="ticket-list">
          {list.entries.map((entry) => (
            <li key={entry.id}>
              <button type="button" className="ticket-row" onClick={() => { onOpen(entry.id); }}>
                <span className="help-question">{entry.question}</span>
                <span className="muted small help-excerpt">{entry.excerpt}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <SuggestQuestion initial={search} onOpenTicket={onOpenTicket} />
    </section>
  );
}

function SuggestQuestion({ initial, onOpenTicket }: { initial: string; onOpenTicket: (draft?: TicketDraft) => void }) {
  const backend = useBackend();
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function send() {
    setSending(true);
    setError('');
    try {
      await backend.suggestFaq(question.trim());
      setSent(true);
      setOpen(false);
      setQuestion('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="detail-card help-suggest">
      <h3 className="help-suggest-title">Não achou o que procura?</h3>
      {sent && <p className="help-thanks" role="status">Pergunta enviada. Quando a equipe responder, ela aparece aqui na Ajuda.</p>}
      {!open && (
        <div className="ss-actions">
          <button type="button" className="btn btn-secondary" onClick={() => { setQuestion(initial.trim()); setOpen(true); setSent(false); }}>
            Enviar uma pergunta
          </button>
          <button type="button" className="btn btn-primary" onClick={() => { onOpenTicket(initial.trim() ? { title: initial.trim().slice(0, 200), description: '' } : undefined); }}>
            Abrir chamado
          </button>
        </div>
      )}
      {open && (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            if (question.trim().length >= 3) void send();
          }}
        >
          <label htmlFor="help-question">Sua pergunta</label>
          <input
            id="help-question"
            value={question}
            maxLength={300}
            placeholder="Como faço para..."
            onChange={(e) => { setQuestion(e.target.value); }}
          />
          <p className="field-hint muted">A equipe responde e publica a resposta na Ajuda. Para um problema urgente, abra um chamado.</p>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="ss-actions">
            <button type="button" className="btn btn-secondary" onClick={() => { setOpen(false); }} disabled={sending}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={sending || question.trim().length < 3}>
              {sending ? 'Enviando...' : 'Enviar pergunta'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

interface EntryProps {
  id: number;
  onBack: () => void;
  onOpenTicket: (draft?: TicketDraft) => void;
}

type Feedback = 'none' | 'sending' | 'helpful' | 'unhelpful';

function HelpEntry({ id, onBack, onOpenTicket }: EntryProps) {
  const backend = useBackend();
  const [entry, setEntry] = useState<FaqEntry | null>(null);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState<Feedback>('none');

  useEffect(() => {
    let alive = true;
    backend.getFaq(id).then(
      (e) => {
        if (alive) setEntry(e);
      },
      (e: unknown) => {
        if (alive) setError(errorMessage(e));
      },
    );
    return () => {
      alive = false;
    };
  }, [backend, id]);

  async function answer(helpful: boolean) {
    setFeedback('sending');
    try {
      await backend.faqFeedback(id, helpful);
    } catch {
      // A avaliacao e so metrica: sem servidor, o usuario segue do mesmo jeito.
    }
    setFeedback(helpful ? 'helpful' : 'unhelpful');
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <button type="button" className="btn btn-link" onClick={onBack}>
          ← Voltar
        </button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {!entry && !error && <p className="muted center">Carregando...</p>}
      {entry && (
        <article className="detail-card" aria-labelledby="help-entry-title">
          {entry.category && <span className="muted small">{entry.category}</span>}
          <h2 id="help-entry-title" className="detail-title">{entry.question}</h2>
          <p className="detail-description">{entry.answer}</p>
        </article>
      )}
      {entry && (
        <div className="detail-card" role="group" aria-label="Avaliar a resposta">
          {(feedback === 'none' || feedback === 'sending') && (
            <>
              <p className="help-ask">Isso resolveu o seu problema?</p>
              <div className="ss-actions">
                <button type="button" className="btn btn-secondary" disabled={feedback === 'sending'} onClick={() => { void answer(false); }}>
                  Não
                </button>
                <button type="button" className="btn btn-primary" disabled={feedback === 'sending'} onClick={() => { void answer(true); }}>
                  Sim, resolveu
                </button>
              </div>
            </>
          )}
          {feedback === 'helpful' && <p className="help-thanks" role="status">Que bom! Obrigado por avisar.</p>}
          {feedback === 'unhelpful' && (
            <>
              <p className="help-ask" role="status">Poxa! Abra um chamado e a equipe de suporte ajuda você.</p>
              <div className="ss-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    onOpenTicket({
                      title: entry.question.slice(0, 200),
                      description: `Segui a resposta "${entry.question}" da Ajuda e o problema continua.`,
                    });
                  }}
                >
                  Abrir chamado
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
