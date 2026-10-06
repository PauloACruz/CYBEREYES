import { afterEach, describe, expect, it, vi } from 'vitest';
import { Coalescer, shouldCapture, toRemotePoint, wheelUnits } from './inputMap';

describe('entrada do visualizador', () => {
  it('converte a posicao exibida para o monitor remoto', () => {
    expect(toRemotePoint(480, 270, { width: 960, height: 540 }, { w: 1920, h: 1080 })).toEqual({ x: 960, y: 540 });
    expect(toRemotePoint(2000, -5, { width: 960, height: 540 }, { w: 1920, h: 1080 })).toEqual({ x: 1919, y: 0 });
  });

  it('converte a roda para unidades de 1/120', () => {
    expect(wheelUnits(100, 0)).toBe(120);
    expect(wheelUnits(-3, 1)).toBe(-120);
  });

  it('captura toda tecla com posicao fisica', () => {
    expect(shouldCapture({ code: 'KeyV' })).toBe(true);
    expect(shouldCapture({ code: 'Tab' })).toBe(true);
    expect(shouldCapture({ code: '' })).toBe(false);
  });

  describe('Coalescer', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('manda o primeiro na hora e junta os seguintes no intervalo', () => {
      vi.useFakeTimers();
      let now = 0;
      const sent: number[] = [];
      const c = new Coalescer<number>((_, next) => next, 16, () => now);
      c.push(1, (v) => sent.push(v));
      c.push(2, (v) => sent.push(v));
      c.push(3, (v) => sent.push(v));
      expect(sent).toEqual([1]);
      now = 16;
      vi.advanceTimersByTime(16);
      expect(sent).toEqual([1, 3]);
      now = 100;
      c.push(4, (v) => sent.push(v));
      expect(sent).toEqual([1, 3, 4]);
    });

    it('soma a roda e manda o pendente antes de um botao', () => {
      vi.useFakeTimers();
      let now = 0;
      const sent: { dx: number; dy: number }[] = [];
      const c = new Coalescer<{ dx: number; dy: number }>((a, b) => ({ dx: a.dx + b.dx, dy: a.dy + b.dy }), 16, () => now);
      c.push({ dx: 0, dy: 120 }, (v) => sent.push(v));
      now = 2;
      c.push({ dx: 0, dy: 120 }, (v) => sent.push(v));
      c.push({ dx: 10, dy: -40 }, (v) => sent.push(v));
      c.flush();
      expect(sent).toEqual([{ dx: 0, dy: 120 }, { dx: 10, dy: 80 }]);
      vi.advanceTimersByTime(50);
      expect(sent).toHaveLength(2);
      c.push({ dx: 1, dy: 1 }, (v) => sent.push(v));
      c.cancel();
      vi.advanceTimersByTime(50);
      expect(sent).toHaveLength(2);
    });
  });
});
