import { useState, type SyntheticEvent, type KeyboardEvent } from 'react';

interface Props {
  enabled: boolean;
  onSend: (body: string) => Promise<void>;
  /** Texto exibido no lugar do campo quando o chat esta bloqueado. */
  lockedText?: string;
  placeholder?: string;
}

export const CHAT_LOCKED_TEXT = 'O chat será liberado quando um técnico assumir o seu chamado.';
export const CHAT_CLOSED_TEXT = 'Este chamado foi encerrado. Se precisar de ajuda de novo, abra um novo chamado.';

export function Composer({ enabled, onSend, lockedText = CHAT_LOCKED_TEXT, placeholder = 'Escreva sua mensagem' }: Props) {
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  if (!enabled) {
    return <p className="chat-locked">{lockedText}</p>;
  }

  async function send(e?: SyntheticEvent) {
    e?.preventDefault();
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    setError('');
    try {
      await onSend(text);
      setBody('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível enviar a mensagem.');
    } finally {
      setSending(false);
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <form className="composer" onSubmit={(e) => { void send(e); }}>
      {error && <p className="error small" role="alert">{error}</p>}
      <div className="composer-row">
        <label htmlFor="message" className="sr-only">Mensagem</label>
        <textarea
          id="message"
          rows={2}
          value={body}
          maxLength={20000}
          placeholder={placeholder}
          onChange={(e) => { setBody(e.target.value); }}
          onKeyDown={onKey}
          disabled={sending}
        />
        <button type="submit" className="btn btn-primary" disabled={sending || !body.trim()}>
          {sending ? '...' : 'Enviar'}
        </button>
      </div>
    </form>
  );
}
