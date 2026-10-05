import { useEffect, useState } from 'react';
import { errorMessage } from '../lib/backend';
import type { Backend, RemoteEvent } from '../lib/types';

interface Pending {
  session: string;
  technician: string;
  deadline: number;
}

interface Active {
  session: string;
  technician: string;
}

function who(technician: string | undefined): string {
  return technician?.trim() ? technician : 'Um técnico';
}

/** Pedido de aceite e aviso de acesso remoto em andamento (contrato do acesso remoto, secao 8.3). */
export function RemoteAccess({ backend, now = Date.now }: { backend: Backend; now?: () => number }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [active, setActive] = useState<Active[]>([]);
  const [left, setLeft] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(
    () =>
      backend.onRemote((e: RemoteEvent) => {
        switch (e.event) {
          case 'remote-ask':
            setPending({ session: e.session, technician: who(e.technician), deadline: now() + (e.timeout ?? 60) * 1000 });
            setError('');
            break;
          case 'remote-notify':
            setPending((p) => (p?.session === e.session ? null : p));
            setActive((list) => [...list.filter((a) => a.session !== e.session), { session: e.session, technician: who(e.technician) }]);
            break;
          case 'remote-ended':
            setPending((p) => (p?.session === e.session ? null : p));
            setActive((list) => list.filter((a) => a.session !== e.session));
            break;
        }
      }),
    [backend, now],
  );

  // Contagem regressiva do pedido; ao zerar, o agente responde "tempo esgotado" sozinho.
  useEffect(() => {
    if (!pending) return;
    const tick = () => {
      const s = Math.max(0, Math.ceil((pending.deadline - now()) / 1000));
      setLeft(s);
      if (s === 0) setPending(null);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => { clearInterval(timer); };
  }, [pending, now]);

  async function answer(accept: boolean) {
    if (!pending) return;
    setBusy(true);
    try {
      await backend.remoteAnswer(pending.session, accept);
      setPending(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function end(session: string) {
    setBusy(true);
    try {
      await backend.remoteEnd(session);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {pending && (
        <div className="remote-overlay">
          <section className="remote-dialog" role="alertdialog" aria-modal="true" aria-labelledby="remote-ask-title">
            <h2 id="remote-ask-title">Pedido de acesso remoto</h2>
            <p>
              <strong>{pending.technician}</strong> quer acessar este computador para ver a tela e usar o mouse e o teclado.
            </p>
            <p className="muted" aria-live="polite">
              Sem resposta, o pedido é recusado em {left} s.
            </p>
            {error && <p className="error" role="alert">{error}</p>}
            <div className="remote-actions">
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void answer(false)}>
                Recusar
              </button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void answer(true)}>
                Permitir
              </button>
            </div>
          </section>
        </div>
      )}
      {active.map((a) => (
        <div key={a.session} className="remote-banner" role="status">
          <span>
            <strong>{a.technician}</strong> está acessando este computador.
          </span>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void end(a.session)}>
            Encerrar acesso
          </button>
        </div>
      ))}
      {!pending && error && active.length > 0 && <p className="error remote-error" role="alert">{error}</p>}
    </>
  );
}
