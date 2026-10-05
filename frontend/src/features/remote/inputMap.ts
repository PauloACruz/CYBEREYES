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

/** Teclas que o navegador nao deve tratar (o foco fica na tela remota). */
export function shouldCapture(event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey'>): boolean {
  // Ctrl+V e Cmd+V seguem para o navegador gerar o evento paste (area de transferencia automatica).
  if (event.code === 'KeyV' && (event.ctrlKey || event.metaKey)) return false;
  return event.code !== '';
}
