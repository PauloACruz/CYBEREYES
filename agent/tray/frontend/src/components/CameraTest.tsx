import { useEffect, useRef, useState } from 'react';
import { describeDevice } from '../lib/diagnostics';
import type { DeviceInfo } from '../lib/types';
import { DeviceList } from './DeviceList';

interface Props {
  cameras: DeviceInfo[];
  supported: boolean;
  onResult: (lines: string[] | null) => void;
}

type Status = 'idle' | 'starting' | 'live' | 'error';

interface Picture {
  label: string;
  width: number;
  height: number;
  fps: number;
  /** Avaliação da imagem pelo brilho médio e pela variação entre os pixels. */
  quality: 'ok' | 'dark' | 'flat';
}

const QUALITY_TEXT: Record<Picture['quality'], string> = {
  ok: 'imagem normal',
  dark: 'imagem quase preta: a câmera pode estar tampada ou desligada pela tecla de privacidade',
  flat: 'imagem uniforme, sem detalhes: a câmera pode estar com defeito ou tampada',
};

function cameraError(e: unknown): string {
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return navigator.userAgent.includes('Windows')
      ? 'O acesso à câmera foi bloqueado. Confira em Configurações › Privacidade e segurança › Câmera se "Permitir que aplicativos da área de trabalho acessem a câmera" está ligado.'
      : 'O acesso à câmera foi bloqueado pelo sistema.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Nenhuma câmera foi encontrada.';
  if (name === 'NotReadableError' || name === 'AbortError') {
    return 'A câmera não respondeu: pode estar em uso por outro programa (Teams, Zoom, navegador) ou com defeito.';
  }
  return 'Não foi possível ligar a câmera.';
}

/** Brilho médio (0 a 255) e desvio padrão de uma amostra pequena do quadro atual. */
function measure(video: HTMLVideoElement): { mean: number; sd: number } | null {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 18;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const lum: number[] = [];
  for (let i = 0; i + 2 < px.length; i += 4) lum.push(0.2126 * (px[i] ?? 0) + 0.7152 * (px[i + 1] ?? 0) + 0.0722 * (px[i + 2] ?? 0));
  const mean = lum.reduce((a, b) => a + b, 0) / lum.length;
  const sd = Math.sqrt(lum.reduce((a, b) => a + (b - mean) ** 2, 0) / lum.length);
  return { mean, sd };
}

/**
 * A câmera só liga quando o usuário clica e desliga ao sair da seção. A imagem fica nesta tela: o
 * resultado leva o nome, a resolução e a avaliação do brilho, nunca a foto.
 */
export function CameraTest({ cameras, supported, onResult }: Props) {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [picture, setPicture] = useState<Picture | null>(null);
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<number | undefined>(undefined);
  // Fora de contexto seguro, ou no WebKitGTK sem captura de mídia, mediaDevices não existe.
  const media = (navigator as { mediaDevices?: MediaDevices }).mediaDevices;
  const available = typeof media?.getUserMedia === 'function';

  function stopStream() {
    window.clearTimeout(timer.current);
    stream.current?.getTracks().forEach((t) => { t.stop(); });
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  }

  // Sair da seção (o componente desmonta) desliga a câmera.
  useEffect(() => stopStream, []);

  async function start() {
    stopStream();
    setStatus('starting');
    setError('');
    setPicture(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId } } : true, audio: false });
      stream.current = s;
      const el = video.current;
      if (el) {
        el.srcObject = s;
        await el.play().catch(() => undefined);
      }
      setStatus('live');
      // Os rótulos das câmeras só aparecem depois da permissão.
      const list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      setInputs(list);
      const track = s.getVideoTracks()[0];
      // A primeira imagem costuma vir escura enquanto a câmera ajusta a exposição.
      timer.current = window.setTimeout(() => {
        const settings = track?.getSettings();
        const m = el ? measure(el) : null;
        const quality: Picture['quality'] = !m ? 'ok' : m.mean < 16 ? 'dark' : m.sd < 2 ? 'flat' : 'ok';
        setPicture({
          label: track?.label || 'Câmera',
          width: settings?.width ?? el?.videoWidth ?? 0,
          height: settings?.height ?? el?.videoHeight ?? 0,
          fps: Math.round(settings?.frameRate ?? 0),
          quality,
        });
      }, 1500);
    } catch (e) {
      stopStream();
      setStatus('error');
      setError(cameraError(e));
      onResult([`Câmera: falhou — ${cameraError(e)}`, ...cameraList(cameras, supported)]);
    }
  }

  function stop() {
    stopStream();
    setStatus('idle');
  }

  useEffect(() => {
    if (!picture) return;
    const res = [picture.width, picture.height].every((n) => n > 0) ? `${String(picture.width)}×${String(picture.height)}` : 'resolução não informada';
    const fps = picture.fps > 0 ? `, ${String(picture.fps)} qps` : '';
    onResult([`Câmera: ligou — ${picture.label}, ${res}${fps}, ${QUALITY_TEXT[picture.quality]}`, ...cameraList(cameras, supported)]);
  }, [picture, cameras, supported, onResult]);

  return (
    <section className="diag-section" aria-label="Teste de câmera">
      <p className="small">
        A imagem aparece só nesta tela e não é enviada ao suporte. O resultado leva apenas o nome da câmera, a resolução e se a
        imagem está normal.
      </p>
      {!available ? (
        <p className="notice">A câmera não pode ser testada por este aplicativo neste sistema.</p>
      ) : (
        <>
          {inputs.length > 1 && (
            <label className="diag-select">
              <span className="muted small">Câmera</span>
              <select
                value={deviceId}
                onChange={(e) => { setDeviceId(e.target.value); }}
                disabled={status === 'starting'}
              >
                <option value="">Padrão do sistema</option>
                {inputs.map((d, i) => (
                  <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Câmera ${String(i + 1)}`}</option>
                ))}
              </select>
            </label>
          )}
          <div className={`cam-frame${status === 'live' ? ' cam-live' : ''}`}>
            <video ref={video} muted playsInline aria-label="Imagem da câmera" />
            {status !== 'live' && <span className="muted small cam-placeholder">{status === 'starting' ? 'Ligando a câmera...' : 'Câmera desligada'}</span>}
          </div>
          {error && <p className="error small" role="alert">{error}</p>}
          {picture && (
            <p className={`small cam-result cam-result-${picture.quality}`} role="status">
              {picture.label}: {picture.width > 0 ? `${String(picture.width)}×${String(picture.height)}` : 'resolução não informada'}
              {picture.fps > 0 ? `, ${String(picture.fps)} qps` : ''} — {QUALITY_TEXT[picture.quality]}.
            </p>
          )}
          <div className="ss-actions">
            {status === 'live' ? (
              <button type="button" className="btn btn-secondary" onClick={stop}>Desligar câmera</button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => { void start(); }} disabled={status === 'starting'}>
                Ligar câmera
              </button>
            )}
          </div>
        </>
      )}
      <DeviceList title="Câmeras conectadas" devices={cameras} empty="Nenhuma câmera encontrada." supported={supported} />
    </section>
  );
}

function cameraList(cameras: DeviceInfo[], supported: boolean): string[] {
  if (!supported) return [];
  return [`Câmeras conectadas: ${cameras.length > 0 ? cameras.map(describeDevice).join('; ') : 'nenhuma encontrada'}`];
}
