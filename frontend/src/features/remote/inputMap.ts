/** Converte a posicao do ponteiro no elemento exibido para pixels do monitor remoto. */
export function toRemotePoint(
  offsetX: number,
  offsetY: number,
  shown: { width: number; height: number },
  remote: { w: number; h: number },
): { x: number; y: number } {
  if (shown.width <= 0 || shown.height <= 0) return { x: 0, y: 0 };
  const x = Math.round((offsetX / shown.width) * remote.w);
  const y = Math.round((offsetY / shown.height) * remote.h);
  return { x: Math.max(0, Math.min(remote.w - 1, x)), y: Math.max(0, Math.min(remote.h - 1, y)) };
}

/** Converte o deslocamento da roda do navegador para unidades de 1/120 de clique (contrato, secao 5.2). */
export function wheelUnits(delta: number, mode: number): number {
  // deltaMode: 0 pixels (cerca de 100 por clique), 1 linhas (3 por clique), 2 paginas.
  const units = mode === 1 ? delta * 40 : mode === 2 ? delta * 120 * 3 : delta * 1.2;
  return Math.round(units);
}

/**
 * Teclas que o navegador nao deve tratar (o foco fica na tela remota). O Ctrl+V com a area de transferencia
 * ligada e tratado no visualizador: o texto local vai antes das teclas.
 */
export function shouldCapture(event: Pick<KeyboardEvent, 'code'>): boolean {
  return event.code !== '';
}

/**
 * Junta eventos frequentes (movimento do mouse, roda) em no maximo um envio por intervalo: o relay limita os quadros
 * por segundo do visualizador (contrato, secao 4.4). O primeiro sai na hora; os seguintes esperam o intervalo, e
 * merge combina os pendentes (o ultimo movimento, a soma da roda). flush manda o pendente na hora (antes de um
 * botao ou tecla, para manter a ordem).
 */
export class Coalescer<T> {
  private pending: T | null = null;
  private send: ((value: T) => void) | null = null;
  private last = Number.NEGATIVE_INFINITY;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly merge: (pending: T, next: T) => T,
    private readonly interval = 16,
    private readonly now: () => number = () => performance.now(),
  ) {}

  push(value: T, send: (value: T) => void): void {
    this.pending = this.pending === null ? value : this.merge(this.pending, value);
    this.send = send;
    const wait = this.last + this.interval - this.now();
    if (wait <= 0) {
      this.flush();
      return;
    }
    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, wait);
  }

  flush(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.pending === null || this.send === null) return;
    const value = this.pending;
    this.pending = null;
    this.last = this.now();
    this.send(value);
  }

  cancel(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = null;
  }
}
