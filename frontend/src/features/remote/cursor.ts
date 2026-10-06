import type { CursorBody } from './protocol';

/** Desenho do cursor remoto (contrato, secao 5.1): PNG em data URL, tamanho e ponto ativo em pixels do desenho. */
export interface CursorShape {
  url: string;
  width: number;
  height: number;
  hotX: number;
  hotY: number;
}

/** Le largura e altura do cabecalho IHDR de um PNG em base64 (sem decodificar a imagem). */
export function pngSize(base64: string): { width: number; height: number } | null {
  let head: string;
  try {
    head = atob(base64.slice(0, 44));
  } catch {
    return null;
  }
  if (head.length < 24 || head.slice(1, 4) !== 'PNG' || head.slice(12, 16) !== 'IHDR') return null;
  const u32 = (o: number) =>
    ((head.charCodeAt(o) << 24) | (head.charCodeAt(o + 1) << 16) | (head.charCodeAt(o + 2) << 8) | head.charCodeAt(o + 3)) >>> 0;
  const width = u32(16);
  const height = u32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** Desenhos recebidos por id: o agente manda o PNG so na primeira vez de cada desenho. */
export class CursorShapes {
  private readonly shapes = new Map<number, CursorShape>();

  update(body: CursorBody): CursorShape | null {
    if (body.png) {
      const size = pngSize(body.png);
      if (size) this.shapes.set(body.id, { url: `data:image/png;base64,${body.png}`, ...size, hotX: body.hotX, hotY: body.hotY });
    }
    return this.shapes.get(body.id) ?? null;
  }
}

/** Cursor CSS com o desenho remoto, para o ponteiro local ter a forma do remoto sem esperar a tela (ate 128 px). */
export function cssCursor(shape: CursorShape | null): string {
  if (!shape || shape.width > 128 || shape.height > 128) return 'default';
  const x = Math.min(Math.max(0, shape.hotX), shape.width - 1);
  const y = Math.min(Math.max(0, shape.hotY), shape.height - 1);
  return `url("${shape.url}") ${String(x)} ${String(y)}, default`;
}

/** Posicao e tamanho do cursor desenhado sobre a tela exibida, em pixels do elemento que contem o canvas. */
export interface CursorPlacement {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Converte o cursor remoto para a tela exibida. x e y chegam em pixels do quadro (ja na escala da imagem); o desenho
 * vem em pixels do monitor e acompanha a escala da imagem e a do canvas na pagina.
 */
export function placeCursor(
  body: Pick<CursorBody, 'x' | 'y'>,
  shape: CursorShape,
  frame: { width: number; height: number },
  shown: { left: number; top: number; width: number; height: number },
  remoteWidth: number,
): CursorPlacement | null {
  if (frame.width <= 0 || frame.height <= 0 || shown.width <= 0 || remoteWidth <= 0) return null;
  const k = shown.width / frame.width;
  const s = (frame.width / remoteWidth) * k;
  return {
    left: shown.left + body.x * k - shape.hotX * s,
    top: shown.top + body.y * k - shape.hotY * s,
    width: shape.width * s,
    height: shape.height * s,
  };
}
