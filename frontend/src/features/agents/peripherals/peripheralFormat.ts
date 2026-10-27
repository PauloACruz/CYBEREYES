import type { PeripheralSection, PeripheralState, PeripheralTest } from '../../../api/types';

export const SECTIONS: PeripheralSection[] = ['keyboard', 'pointer', 'usb', 'camera'];

export const SECTION_LABEL: Record<PeripheralSection, string> = {
  keyboard: 'Teclado',
  pointer: 'Mouse e touchpad',
  usb: 'USB',
  camera: 'Câmera',
};

/** Dispositivos de cada seção na lista que o app manda. */
export const SECTION_KINDS: Record<PeripheralSection, string[]> = {
  keyboard: ['keyboard'],
  pointer: ['pointer', 'touchpad'],
  usb: ['usb'],
  camera: ['camera'],
};

export const VERDICT_COLOR = { pending: 'gray', ok: 'teal', mismatch: 'red', unknown: 'yellow' } as const;

export function isOpen(test: PeripheralTest | null | undefined): boolean {
  return test?.status === 'pending' || test?.status === 'active';
}

/** Resumo em texto para colar no chamado, com as seções testadas. */
export function buildSummary(state: PeripheralState, when: Date): string {
  const stamp = when.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const lines = [`Teste de periféricos${state.hostname ? ` no computador ${state.hostname}` : ''} (${stamp})`];
  for (const s of SECTIONS) {
    const r = state.results[s];
    if (!r || r.length === 0) continue;
    lines.push('', SECTION_LABEL[s].toUpperCase(), ...r.map((l) => `- ${l}`));
  }
  const missing = SECTIONS.filter((s) => !state.results[s]).map((s) => SECTION_LABEL[s]);
  if (missing.length > 0) lines.push('', `Não testado: ${missing.join(', ')}.`);
  return lines.join('\n');
}
