/** Variacao em relacao a janela anterior do mesmo tamanho. */
export function trendLabel(count: number, previous: number): { text: string; up: boolean | null } {
  if (previous === 0) return { text: 'novo no período', up: true };
  const change = Math.round(((count - previous) / previous) * 100);
  if (change === 0) return { text: 'estável', up: null };
  return { text: `${change > 0 ? '+' : ''}${change}% em relação ao período anterior`, up: change > 0 };
}
