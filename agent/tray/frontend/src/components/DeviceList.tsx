import type { DeviceInfo } from '../lib/types';

interface Props {
  title: string;
  devices: DeviceInfo[];
  /** Texto quando a leitura funcionou e não achou nenhum. */
  empty: string;
  /** Falso quando o sistema não lê os dispositivos (lista some). */
  supported: boolean;
}

export function DeviceList({ title, devices, empty, supported }: Props) {
  if (!supported) return null;
  return (
    <div className="diag-devices">
      <h4 className="section-title">{title}</h4>
      {devices.length === 0 ? (
        <p className="muted small">{empty}</p>
      ) : (
        <ul className="diag-device-list">
          {devices.map((d) => (
            <li key={d.id} className="diag-device">
              <span className={`dot ${d.ok ? 'dot-on' : 'dot-off'}`} aria-hidden="true" />
              <span className="diag-device-text">
                <span className="diag-device-name">{d.name}</span>
                <span className="muted small">
                  {[d.model, d.manufacturer, d.bus].filter(Boolean).join(' · ')}
                </span>
                {!d.ok && <span className="diag-device-problem">{d.problem ?? 'Com problema'}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
