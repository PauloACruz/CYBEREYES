import type { KeyboardVerdict } from './keyboard';
import type { DeviceInfo, KeyboardLayoutInfo } from './types';

/** Seções da aba de testes, na ordem em que aparecem e entram no resultado. */
export type DiagSection = 'keyboard' | 'pointer' | 'usb' | 'camera';

export const SECTION_LABEL: Record<DiagSection, string> = {
  keyboard: 'Teclado',
  pointer: 'Mouse e touchpad',
  usb: 'USB',
  camera: 'Câmera',
};

export const SECTIONS: DiagSection[] = ['keyboard', 'pointer', 'usb', 'camera'];

/** Linhas de resultado de cada seção; null enquanto a seção não foi testada. */
export type DiagResults = Record<DiagSection, string[] | null>;

export const EMPTY_RESULTS: DiagResults = { keyboard: null, pointer: null, usb: null, camera: null };

/** Uma linha por dispositivo: "Dispositivo de teclado HID (USB Receiver, USB)" e o problema, se houver. */
export function describeDevice(d: DeviceInfo): string {
  const extra = [d.model, d.bus].filter((x): x is string => Boolean(x));
  const base = extra.length > 0 ? `${d.name} (${extra.join(', ')})` : d.name;
  return d.ok ? base : `${base} — ${d.problem ?? 'com problema'}`;
}

/**
 * Teclado ao vivo, como o console desenha: o texto digitado alinhado com o de referência, as teclas
 * pressionadas e o que o sistema escreve em cada uma. O console tem o mesmo formato em
 * frontend/src/features/agents/peripherals.
 */
export interface KeyboardLiveState {
  layout: KeyboardLayoutInfo | null;
  reference: string;
  typed: string;
  /** Alinhamento: m igual, s trocado, i a mais, d faltou; e esperado, g escrito. */
  ops: { t: 'm' | 's' | 'i' | 'd'; e?: string; g?: string }[];
  verdict: KeyboardVerdict;
  message: string;
  model: string | null;
  differences: string[];
  pressed: string[];
  down: string[];
  layoutKeys: Record<string, string>;
  others: string[];
  tested: number;
  total: number;
}

/** Estado enviado ao console a cada mudança na tela de teste. */
export interface PeripheralState {
  section: DiagSection;
  hostname: string;
  devices: DeviceInfo[];
  supported: boolean;
  keyboard: KeyboardLiveState | null;
  results: DiagResults;
}

export interface UsbEvent {
  at: Date;
  type: 'in' | 'out';
  device: DeviceInfo;
}

/** Quem entrou e quem saiu entre duas leituras, só entre os aparelhos USB. */
export function diffUsb(before: DeviceInfo[], after: DeviceInfo[], at: Date): UsbEvent[] {
  const usb = (l: DeviceInfo[]) => new Map(l.filter((d) => d.kind === 'usb').map((d) => [d.id, d]));
  const a = usb(before);
  const b = usb(after);
  const events: UsbEvent[] = [];
  for (const [id, d] of b) if (!a.has(id)) events.push({ at, type: 'in', device: d });
  for (const [id, d] of a) if (!b.has(id)) events.push({ at, type: 'out', device: d });
  return events;
}
