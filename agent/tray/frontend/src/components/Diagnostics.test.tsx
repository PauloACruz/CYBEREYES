import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PeripheralState } from '../lib/diagnostics';
import { REFERENCE_TEXT } from '../lib/keyboard';
import type { Backend, DeviceSnapshot, KeyboardLayoutInfo, PeripheralTestInfo } from '../lib/types';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { PointerTest } from './PointerTest';

afterEach(cleanup);

const snapshot: DeviceSnapshot = {
  supported: true,
  devices: [
    { id: 'kb', kind: 'keyboard', name: 'Dispositivo de teclado HID', model: 'USB Receiver', bus: 'USB', ok: true },
    { id: 'u1', kind: 'usb', name: 'USB Receiver', bus: 'USB', ok: true },
  ],
};

const report = vi.fn<Backend['reportPeripheralTest']>(() => Promise.resolve());
const endTest = vi.fn<Backend['endPeripheralTest']>(() => Promise.resolve());

function fakeBackend(layout: KeyboardLayoutInfo): Backend {
  report.mockClear();
  endTest.mockClear();
  return {
    devices: () => Promise.resolve(snapshot),
    keyboardLayout: () => Promise.resolve(layout),
    reportPeripheralTest: report,
    endPeripheralTest: endTest,
  } as unknown as Backend;
}

const keyboardTest: PeripheralTestInfo = { testId: 7, section: 'keyboard', technician: 'Ana Souza' };

/** Último estado que o técnico recebeu. */
function lastState(): PeripheralState {
  const calls = report.mock.calls;
  const last = calls[calls.length - 1];
  expect(last?.[0]).toBe(7);
  return last?.[1] as PeripheralState;
}

// O que o ABNT2 escreve em cada símbolo do texto de referência; letras e números saem da própria tecla.
const ABNT2: Record<string, string> = {
  'ç': 'Semicolon', ';': 'Slash', ':': 'Slash', '/': 'IntlRo', '?': 'IntlRo', '[': 'BracketRight', '{': 'BracketRight',
  ']': 'Backslash', '}': 'Backslash', '\\': 'IntlBackslash', '|': 'IntlBackslash', "'": 'Backquote', '"': 'Backquote', ' ': 'Space',
};

function codeOf(c: string): string {
  if (ABNT2[c]) return ABNT2[c];
  if (/[0-9]/.test(c)) return `Digit${c}`;
  return `Key${c.normalize('NFD').slice(0, 1).toUpperCase()}`;
}

/** Digita como no app: keydown de cada tecla (a análise lê a tecla física) e o texto no campo. */
function typeText(field: HTMLElement, text: string, produce: (c: string) => string = (c) => c) {
  let value = '';
  for (const c of Array.from(text)) {
    const out = produce(c);
    fireEvent.keyDown(field, { code: codeOf(c), key: out || 'Unidentified' });
    value += out;
  }
  fireEvent.change(field, { target: { value } });
}

describe('DiagnosticsPanel: teste aberto pelo técnico', () => {
  it('mostra quem acompanha e manda ao console o texto digitado, o layout e o resultado', async () => {
    render(<DiagnosticsPanel backend={fakeBackend({ id: '00010416', name: 'Português (Brasil ABNT2)' })} hostname="ESTACAO-01" test={keyboardTest} onEnd={vi.fn()} />);
    expect(screen.getByText(/está acompanhando este teste ao vivo/).textContent).toContain('Ana Souza está acompanhando');
    expect(await screen.findByText('Português (Brasil ABNT2)')).toBeTruthy();
    const field = screen.getByLabelText('Digite o texto abaixo olhando para as teclas do teclado:');
    expect(document.activeElement).toBe(field);

    typeText(field, REFERENCE_TEXT);
    expect(screen.getByTestId('kb-typed').textContent).toBe(REFERENCE_TEXT);
    await waitFor(() => { expect(lastState().keyboard?.typed).toBe(REFERENCE_TEXT); });
    const state = lastState();
    expect(state.section).toBe('keyboard');
    expect(state.hostname).toBe('ESTACAO-01');
    expect(state.keyboard?.verdict).toBe('ok');
    expect(state.keyboard?.model).toBe('ABNT2 (brasileiro, com a tecla Ç)');
    expect(state.keyboard?.layout?.name).toBe('Português (Brasil ABNT2)');
    expect(state.keyboard?.pressed).toContain('IntlRo');
    expect(state.keyboard?.layoutKeys.Semicolon).toBe('ç');
    expect(state.results.keyboard).toContain('Resultado: As teclas batem com o layout configurado.');
    expect(state.devices.map((d) => d.id)).toEqual(['kb', 'u1']);
  });

  it('aponta o layout errado quando o ABNT2 está configurado como inglês (EUA)', async () => {
    render(<DiagnosticsPanel backend={fakeBackend({ id: '00000409', name: 'Inglês (Estados Unidos)' })} hostname="ESTACAO-01" test={keyboardTest} onEnd={vi.fn()} />);
    expect(await screen.findByText('Inglês (Estados Unidos)')).toBeTruthy();

    // O layout dos EUA nas teclas do ABNT2.
    const us: Record<string, string> = {
      'ç': ';', ';': '/', ':': '?', '/': '', '?': '', '[': ']', '{': '}', ']': '\\', '}': '|', "'": '`', '"': '~', 'ã': 'a', 'é': 'e',
    };
    typeText(screen.getByLabelText('Digite o texto abaixo olhando para as teclas do teclado:'), REFERENCE_TEXT, (c) => us[c] ?? c);
    await waitFor(() => { expect(lastState().keyboard?.verdict).toBe('mismatch'); });
    expect(lastState().keyboard?.message).toContain('Ajuste o layout para Português (Brasil ABNT2)');
    expect(lastState().keyboard?.differences).toContain('A tecla “ç” escreveu “;” (tecla Semicolon)');
  });

  it('o técnico troca a seção e o usuário pode encerrar', async () => {
    const backend = fakeBackend({ id: 'br', name: 'Português (Brasil ABNT2)' });
    const onEnd = vi.fn();
    const { rerender } = render(<DiagnosticsPanel backend={backend} hostname="" test={keyboardTest} onEnd={onEnd} />);
    expect(screen.getByRole('heading', { name: 'Teste de teclado' })).toBeTruthy();
    rerender(<DiagnosticsPanel backend={backend} hostname="" test={{ ...keyboardTest, section: 'usb' }} onEnd={onEnd} />);
    expect(screen.getByRole('heading', { name: 'Teste de usb' })).toBeTruthy();
    await waitFor(() => { expect(lastState().section).toBe('usb'); });

    fireEvent.click(screen.getByRole('button', { name: 'Encerrar teste' }));
    await waitFor(() => { expect(onEnd).toHaveBeenCalled(); });
    expect(endTest).toHaveBeenCalledWith(7);
  });

  it('impede o Ctrl+V no campo do texto', async () => {
    render(<DiagnosticsPanel backend={fakeBackend({ id: 'br', name: 'Português (Brasil ABNT2)' })} hostname="" test={keyboardTest} onEnd={vi.fn()} />);
    const field = screen.getByLabelText('Digite o texto abaixo olhando para as teclas do teclado:');
    await screen.findByText('Português (Brasil ABNT2)');
    fireEvent.paste(field);
    expect(screen.getByText('Colar não vale: digite o texto pelo teclado.')).toBeTruthy();
    const ev = new KeyboardEvent('keydown', { code: 'KeyV', key: 'v', ctrlKey: true, bubbles: true, cancelable: true });
    act(() => { field.dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(true);
  });
});

describe('PointerTest', () => {
  it('marca os cliques e a rolagem e monta o resultado', () => {
    const onResult = vi.fn();
    render(<PointerTest active pointers={[]} supported={false} onResult={onResult} />);
    const area = screen.getByTestId('pt-area');
    fireEvent.pointerDown(area, { button: 2, pointerType: 'mouse' });
    fireEvent.pointerDown(area, { button: 0, pointerType: 'mouse' });
    fireEvent.wheel(area, { deltaY: 100 });
    expect(screen.getByText('Clique direito').closest('li')?.className).toBe('pt-ok');
    expect(screen.getByText('Rolar a roda para cima e para baixo').closest('li')?.className).toBe('pt-ok');
    const lines = onResult.mock.calls.at(-1)?.[0] as string[];
    expect(lines[0]).toMatch(/^Mouse: 3 de 7 itens funcionaram; não testado ou sem resposta: clique da roda/);
  });
});
