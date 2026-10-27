import { useEffect, useRef, useState } from 'react';
import { errorMessage } from './backend';
import { diffUsb, type UsbEvent } from './diagnostics';
import type { Backend, DeviceSnapshot } from './types';

// Leitura enquanto o teste de USB esta aberto: rapida o bastante para o usuario ver o pendrive
// aparecer logo depois de conectar.
const POLL_MS = 2000;

/**
 * Le os dispositivos ao abrir a aba e, com poll ligado (secao USB), a cada 2 s, registrando quem
 * entrou e quem saiu.
 */
export function useDevices(backend: Backend, poll: boolean) {
  const [snapshot, setSnapshot] = useState<DeviceSnapshot | null>(null);
  const [error, setError] = useState('');
  const [events, setEvents] = useState<UsbEvent[]>([]);
  const last = useRef<DeviceSnapshot | null>(null);

  useEffect(() => {
    let alive = true;
    const read = () => {
      backend.devices().then(
        (s) => {
          if (!alive) return;
          const prev = last.current;
          last.current = s;
          setSnapshot(s);
          setError('');
          if (prev) {
            const diff = diffUsb(prev.devices, s.devices, new Date());
            if (diff.length > 0) setEvents((list) => [...diff, ...list].slice(0, 50));
          }
        },
        (e: unknown) => {
          if (alive) setError(errorMessage(e));
        },
      );
    };
    read();
    if (!poll) return () => { alive = false; };
    const timer = setInterval(read, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [backend, poll]);

  return { snapshot, error, events, clearEvents: () => { setEvents([]); } };
}
