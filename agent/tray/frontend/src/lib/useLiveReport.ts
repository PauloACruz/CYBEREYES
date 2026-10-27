import { useEffect, useRef, useState } from 'react';
import type { Backend } from './types';

// No maximo um envio a cada 200 ms: o tecnico ve cada tecla quase na hora sem uma requisicao por evento.
const THROTTLE_MS = 200;

/**
 * Envia o estado da tela de teste ao console. Os envios saem em ordem (um por vez) e o ultimo estado
 * sempre chega. Devolve se o ultimo envio falhou, para avisar o usuario que o tecnico nao esta vendo.
 */
export function useLiveReport(backend: Backend, testId: number, state: unknown): boolean {
  const pending = useRef<{ value: unknown } | null>(null);
  const sending = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    pending.current = { value: state };
    const flush = () => {
      const next = pending.current;
      if (sending.current || !next) return;
      pending.current = null;
      sending.current = true;
      backend.reportPeripheralTest(testId, next.value).then(
        () => { setFailed(false); },
        () => { setFailed(true); },
      ).finally(() => {
        sending.current = false;
        if (pending.current) flush();
      });
    };
    if (timer.current === undefined) {
      timer.current = window.setTimeout(() => {
        timer.current = undefined;
        flush();
      }, THROTTLE_MS);
    }
  }, [backend, testId, state]);

  useEffect(() => () => { window.clearTimeout(timer.current); }, []);

  return failed;
}
