import { describe, expect, it } from 'vitest';
import { CursorShapes, cssCursor, placeCursor, pngSize } from './cursor';

// Cabecalho de um PNG 20x32 (assinatura + IHDR), o bastante para pngSize.
function pngHeader(width: number, height: number): string {
  const bytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52];
  for (const v of [width, height]) bytes.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
  bytes.push(8, 6, 0, 0, 0, 0, 0, 0, 0);
  return btoa(String.fromCharCode(...bytes));
}

describe('cursor remoto', () => {
  it('le o tamanho do PNG pelo cabecalho', () => {
    expect(pngSize(pngHeader(20, 32))).toEqual({ width: 20, height: 32 });
    expect(pngSize('nao e png')).toBeNull();
    expect(pngSize(btoa('GIF89a.................................'))).toBeNull();
  });

  it('guarda o desenho pelo id e reaproveita sem o PNG', () => {
    const shapes = new CursorShapes();
    const first = shapes.update({ visible: true, x: 1, y: 2, id: 7, hotX: 3, hotY: 4, png: pngHeader(20, 32) });
    expect(first).toMatchObject({ width: 20, height: 32, hotX: 3, hotY: 4 });
    expect(first?.url.startsWith('data:image/png;base64,')).toBe(true);
    expect(shapes.update({ visible: true, x: 5, y: 6, id: 7, hotX: 3, hotY: 4, png: null })).toBe(first);
    expect(shapes.update({ visible: true, x: 5, y: 6, id: 8, hotX: 0, hotY: 0, png: null })).toBeNull();
  });

  it('cursor CSS com o ponto ativo dentro do desenho', () => {
    const shape = { url: 'data:image/png;base64,AAAA', width: 32, height: 32, hotX: 40, hotY: -2 };
    expect(cssCursor(shape)).toBe('url("data:image/png;base64,AAAA") 31 0, default');
    expect(cssCursor({ ...shape, width: 256 })).toBe('default');
    expect(cssCursor(null)).toBe('default');
  });

  it('posiciona o cursor na tela exibida seguindo as escalas', () => {
    const shape = { url: 'x', width: 32, height: 32, hotX: 4, hotY: 8 };
    // Monitor de 1600 px, quadro a 0,75 (1200 px), canvas exibido com 600 px a partir de (10, 20).
    const placed = placeCursor({ x: 600, y: 300 }, shape, { width: 1200, height: 675 }, { left: 10, top: 20, width: 600, height: 337.5 }, 1600);
    // k = 0,5; desenho a 0,75 x 0,5 = 0,375.
    expect(placed).toEqual({ left: 10 + 300 - 4 * 0.375, top: 20 + 150 - 8 * 0.375, width: 12, height: 12 });
    expect(placeCursor({ x: 0, y: 0 }, shape, { width: 0, height: 0 }, { left: 0, top: 0, width: 600, height: 300 }, 1600)).toBeNull();
  });
});
