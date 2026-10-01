import { describe, expect, it } from 'vitest';
import { formatBitsPerSecond, formatDuration } from './format';

describe('formatação de taxas e duração', () => {
  it('humaniza bits por segundo na base 1000', () => {
    expect(formatBitsPerSecond(0)).toBe('0 bps');
    expect(formatBitsPerSecond(950)).toBe('950 bps');
    expect(formatBitsPerSecond(1500)).toBe('1,5 kbps');
    expect(formatBitsPerSecond(94_300_000)).toBe('94,3 Mbps');
    expect(formatBitsPerSecond(1_000_000_000)).toBe('1 Gbps');
    expect(formatBitsPerSecond(null)).toBe('Sem dados');
    expect(formatBitsPerSecond(-1)).toBe('Sem dados');
  });

  it('humaniza o uptime', () => {
    expect(formatDuration(30)).toBe('menos de 1 min');
    expect(formatDuration(3_720)).toBe('1 h 2 min');
    expect(formatDuration(93_784)).toBe('1 d 2 h');
    expect(formatDuration(null)).toBe('Não informado');
  });
});
