import { useEffect, useMemo } from 'react';
import { describeDevice, type UsbEvent } from '../lib/diagnostics';
import type { DeviceInfo } from '../lib/types';
import { DeviceList } from './DeviceList';

interface Props {
  active: boolean;
  usb: DeviceInfo[];
  supported: boolean;
  error: string;
  events: UsbEvent[];
  onClear: () => void;
  onResult: (lines: string[] | null) => void;
}

const time = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function UsbTest({ active, usb, supported, error, events, onClear, onResult }: Props) {
  const lines = useMemo(() => {
    if (!supported) return null;
    const problems = usb.filter((d) => !d.ok);
    const out = [`Aparelhos USB conectados: ${String(usb.length)}${usb.length > 0 ? ` (${usb.map(describeDevice).join('; ')})` : ''}`];
    if (problems.length > 0) out.push(`Com problema: ${problems.map(describeDevice).join('; ')}`);
    const ins = events.filter((e) => e.type === 'in');
    const outs = events.filter((e) => e.type === 'out');
    if (ins.length > 0) out.push(`Reconhecidos ao conectar durante o teste: ${String(ins.length)} (${ins.map((e) => e.device.name).join(', ')})`);
    if (outs.length > 0) out.push(`Desconectados durante o teste: ${String(outs.length)}`);
    if (ins.length === 0) out.push('Nenhum aparelho foi conectado durante o teste.');
    return out;
  }, [supported, usb, events]);

  // A lista de USB entra no resultado só depois de o usuário abrir a seção.
  useEffect(() => {
    if (active) onResult(lines);
  }, [active, lines, onResult]);

  if (!supported) {
    return (
      <section className="diag-section" hidden={!active} aria-label="Teste de USB">
        <p className="muted">A lista de dispositivos USB não está disponível neste sistema.</p>
      </section>
    );
  }

  return (
    <section className="diag-section" hidden={!active} aria-label="Teste de USB">
      <p className="small">
        Conecte um pendrive, um mouse ou o cabo do celular em cada porta USB, uma de cada vez, e espere aparecer abaixo.
        Porta que não reconhece nada pode estar com defeito.
      </p>
      {error && <p className="error small" role="alert">{error}</p>}
      <div className="diag-devices">
        <h4 className="section-title">Conexões durante o teste</h4>
        {events.length === 0 ? (
          <p className="muted small" aria-live="polite">Aguardando um aparelho...</p>
        ) : (
          <ul className="usb-events" aria-live="polite">
            {events.map((e) => (
              <li key={`${e.device.id}-${String(e.at.getTime())}-${e.type}`} className={`usb-event usb-event-${e.type}`}>
                <span className="usb-event-time">{time.format(e.at)}</span>
                <span>{e.type === 'in' ? 'Conectado' : 'Desconectado'}: {e.device.name}</span>
                {e.type === 'in' && !e.device.ok && <span className="diag-device-problem">{e.device.problem}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <DeviceList title="Aparelhos USB agora" devices={usb} empty="Nenhum aparelho USB conectado." supported={supported} />
      {events.length > 0 && (
        <div className="ss-actions">
          <button type="button" className="btn btn-secondary" onClick={onClear}>Limpar lista</button>
        </div>
      )}
    </section>
  );
}
