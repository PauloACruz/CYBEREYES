import { describe, expect, it } from 'vitest';
import { shouldCapture, toRemotePoint, wheelUnits } from './inputMap';

describe('entrada do visualizador', () => {
  it('converte a posicao exibida para o monitor remoto', () => {
    expect(toRemotePoint(480, 270, { width: 960, height: 540 }, { w: 1920, h: 1080 })).toEqual({ x: 960, y: 540 });
    expect(toRemotePoint(2000, -5, { width: 960, height: 540 }, { w: 1920, h: 1080 })).toEqual({ x: 1919, y: 0 });
  });

  it('converte a roda para unidades de 1/120', () => {
    expect(wheelUnits(100, 0)).toBe(120);
    expect(wheelUnits(-3, 1)).toBe(-120);
  });

  it('deixa Ctrl+V para o evento paste', () => {
    expect(shouldCapture({ code: 'KeyV', ctrlKey: true, metaKey: false })).toBe(false);
    expect(shouldCapture({ code: 'KeyV', ctrlKey: false, metaKey: false })).toBe(true);
    expect(shouldCapture({ code: 'Tab', ctrlKey: false, metaKey: false })).toBe(true);
  });
});
