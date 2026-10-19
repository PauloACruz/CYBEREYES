import { useState, type KeyboardEvent, type SyntheticEvent } from 'react';
import { assistantGreeting, deriveTitle } from '../lib/assistant';

interface Props {
  assistantName: string;
  username: string;
  onSubmit: (title: string, description: string, includeScreenshot: boolean) => Promise<void>;
  onCancel: () => void;
}

const MIN_LENGTH = 3;

/** Abertura do chamado conversando com o assistente: a primeira mensagem do usuario vira a descricao. */
export function AssistantStart({ assistantName, username, onSubmit, onCancel }: Props) {
  const [text, setText] = useState('');
  const [screenshot, setScreenshot] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const trimmed = text.trim();

  async function submit(e?: SyntheticEvent) {
    e?.preventDefault();
    if (trimmed.length < MIN_LENGTH || sending) return;
    setSending(true);
    setError('');
    try {
      await onSubmit(deriveTitle(trimmed), trimmed, screenshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível abrir o chamado.');
      setSending(false);
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <section className="panel assistant-start">
      <div className="panel-head">
        <button type="button" className="btn btn-link" onClick={onCancel} disabled={sending}>
          ‹ Voltar
        </button>
        <h2>Abrir chamado</h2>
      </div>
      <ol className="chat" aria-label="Conversa">
        <li className="msg msg-assistant" data-author="assistant">
          <div className="bubble">
            <div className="msg-author">{assistantName}</div>
            <div className="msg-body">{assistantGreeting(assistantName, username)}</div>
          </div>
        </li>
      </ol>
      <form className="form" onSubmit={(e) => { void submit(e); }}>
        <label htmlFor="problem" className="sr-only">Descreva o problema</label>
        <textarea
          id="problem"
          value={text}
          maxLength={20000}
          rows={5}
          placeholder="Escreva aqui o que está acontecendo"
          onChange={(e) => { setText(e.target.value); }}
          onKeyDown={onKey}
          disabled={sending}
          autoFocus
        />
        <label className="checkbox">
          <input type="checkbox" checked={screenshot} onChange={(e) => { setScreenshot(e.target.checked); }} disabled={sending} />
          Anexar captura da tela
        </label>
        {screenshot && (
          <p className="field-hint muted">A janela do EYES some por um instante enquanto a tela é capturada.</p>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={sending || trimmed.length < MIN_LENGTH}>
          {sending ? 'Enviando...' : 'Enviar'}
        </button>
      </form>
    </section>
  );
}
