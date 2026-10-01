/** Maximo "redondo" para o eixo Y (1, 2, 2,5 ou 5 vezes uma potencia de 10). */
export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (value <= step * exp) return step * exp;
  }
  return 10 * exp;
}

export const timeFormat = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
export const dayFormat = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });
export const fullFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** Formato do eixo de tempo conforme o tamanho da janela. */
export function tickFormatFor(spanMs: number): Intl.DateTimeFormat {
  return spanMs <= 36 * 3_600_000 ? timeFormat : dayFormat;
}
