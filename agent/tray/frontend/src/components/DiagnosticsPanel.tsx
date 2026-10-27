import { useCallback, useMemo, useState } from 'react';
import { errorMessage } from '../lib/backend';
import { EMPTY_RESULTS, SECTION_LABEL, type DiagResults, type DiagSection, type KeyboardLiveState, type PeripheralState } from '../lib/diagnostics';
import type { Backend, PeripheralTestInfo } from '../lib/types';
import { useDevices } from '../lib/useDevices';
import { useLiveReport } from '../lib/useLiveReport';
import { CameraTest } from './CameraTest';
import { KeyboardTest } from './KeyboardTest';
import { PointerTest } from './PointerTest';
import { UsbTest } from './UsbTest';

interface Props {
  backend: Backend;
  hostname: string;
  /** Teste aberto pelo técnico: ele escolhe a seção pelo console. */
  test: PeripheralTestInfo;
  /** O usuário encerrou pelo botão. */
  onEnd: () => void;
}

function sameLines(a: string[] | null, b: string[] | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((l, i) => l === b[i]);
}

/**
 * Tela de teste de periféricos aberta pelo técnico no console, normalmente com o usuário ao telefone.
 * Não há o que procurar nem enviar: a seção vem do técnico e tudo o que acontece na tela vai para o
 * console ao vivo. A faixa no topo diz quem está acompanhando.
 */
export function DiagnosticsPanel({ backend, hostname, test, onEnd }: Props) {
  const section: DiagSection = test.section;
  const [results, setResults] = useState<DiagResults>(EMPTY_RESULTS);
  const [keyboard, setKeyboard] = useState<KeyboardLiveState | null>(null);
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState('');
  const devices = useDevices(backend, section === 'usb');
  const all = useMemo(() => devices.snapshot?.devices ?? [], [devices.snapshot]);
  const supported = devices.snapshot?.supported ?? false;
  const byKind = useMemo(
    () => ({
      keyboard: all.filter((d) => d.kind === 'keyboard'),
      pointer: all.filter((d) => d.kind === 'pointer' || d.kind === 'touchpad'),
      camera: all.filter((d) => d.kind === 'camera'),
      usb: all.filter((d) => d.kind === 'usb'),
    }),
    [all],
  );

  const setResult = useCallback((s: DiagSection, lines: string[] | null) => {
    setResults((r) => (sameLines(r[s], lines) ? r : { ...r, [s]: lines }));
  }, []);
  const onKeyboard = useCallback((l: string[] | null) => { setResult('keyboard', l); }, [setResult]);
  const onPointer = useCallback((l: string[] | null) => { setResult('pointer', l); }, [setResult]);
  const onUsb = useCallback((l: string[] | null) => { setResult('usb', l); }, [setResult]);
  const onCamera = useCallback((l: string[] | null) => { setResult('camera', l); }, [setResult]);

  const state = useMemo<PeripheralState>(
    () => ({ section, hostname, devices: all, supported, keyboard, results }),
    [section, hostname, all, supported, keyboard, results],
  );
  const offline = useLiveReport(backend, test.testId, state);

  async function end() {
    setEnding(true);
    setEndError('');
    try {
      await backend.endPeripheralTest(test.testId);
      onEnd();
    } catch (e) {
      setEndError(errorMessage(e));
      setEnding(false);
    }
  }

  return (
    <section className="panel">
      <div className="diag-banner" role="status">
        <p>
          <strong>{test.technician || 'O suporte'}</strong> está acompanhando este teste ao vivo: o que você digitar e clicar nesta tela
          aparece para o técnico.
        </p>
        <button type="button" className="btn btn-secondary" onClick={() => { void end(); }} disabled={ending}>
          Encerrar teste
        </button>
      </div>
      {endError && <p className="error small" role="alert">{endError}</p>}
      {offline && <p className="notice">Sem conexão com o servidor: o técnico pode não estar vendo o teste. Tentando de novo...</p>}
      <div className="panel-head">
        <h2>Teste de {SECTION_LABEL[section].toLowerCase()}</h2>
      </div>
      {devices.error && <p className="error small" role="alert">{devices.error}</p>}
      {devices.snapshot?.error && <p className="notice">{devices.snapshot.error}</p>}

      <KeyboardTest
        backend={backend}
        active={section === 'keyboard'}
        keyboards={byKind.keyboard}
        supported={supported}
        onResult={onKeyboard}
        onState={setKeyboard}
      />
      <PointerTest active={section === 'pointer'} pointers={byKind.pointer} supported={supported} onResult={onPointer} />
      <UsbTest
        active={section === 'usb'}
        usb={byKind.usb}
        supported={supported}
        error={devices.error}
        events={devices.events}
        onClear={devices.clearEvents}
        onResult={onUsb}
      />
      {section === 'camera' && <CameraTest cameras={byKind.camera} supported={supported} onResult={onCamera} />}
    </section>
  );
}
