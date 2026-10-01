import { useState, type KeyboardEvent } from 'react';
import { Box, Group, Paper, Text } from '@mantine/core';
import { useElementSize } from '@mantine/hooks';
import { formatInteger } from '../../lib/format';
import { fullFormat, niceMax, tickFormatFor } from './chartScale';
import './charts.css';

const HEIGHT = 180;
const PAD = { top: 10, right: 12, bottom: 26, left: 44 };
const GAP = 2;
const RADIUS = 4;

export interface StackKey<K extends string> {
  key: K;
  label: string;
  color: string;
}

export interface StackBucket<K extends string> {
  time: string;
  values: Record<K, number>;
}

interface StackedBarChartProps<K extends string> {
  buckets: StackBucket<K>[];
  /** Da base para o topo. */
  keys: StackKey<K>[];
  label: string;
}

/** Retangulo com os cantos de cima arredondados (ponta do dado), base reta no eixo. */
function topRoundedRect(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

/** Barras empilhadas por periodo, com dica por barra (mouse ou setas do teclado). */
export function StackedBarChart<K extends string>({ buckets, keys, label }: StackedBarChartProps<K>) {
  const { ref, width } = useElementSize();
  const [active, setActive] = useState<number | null>(null);

  const totals = buckets.map((b) => keys.reduce((sum, k) => sum + (b.values[k.key] || 0), 0));
  const yMax = niceMax(Math.max(0, ...totals));
  const plotW = Math.max(width - PAD.left - PAD.right, 1);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const slot = buckets.length > 0 ? plotW / buckets.length : plotW;
  const barW = Math.max(Math.min(slot - GAP, 28), 1);
  const scale = (v: number) => (v / yMax) * plotH;
  const times = buckets.map((b) => new Date(b.time).getTime());
  const span = times.length > 1 ? (times[times.length - 1] ?? 0) - (times[0] ?? 0) : 0;
  const tickFormat = tickFormatFor(span);
  const tickEvery = Math.max(1, Math.ceil(buckets.length / Math.max(1, Math.floor(plotW / 70))));

  const onKeyDown = (e: KeyboardEvent<SVGRectElement>) => {
    if (buckets.length === 0) return;
    if (e.key === 'ArrowRight') setActive((i) => Math.min((i ?? -1) + 1, buckets.length - 1));
    else if (e.key === 'ArrowLeft') setActive((i) => Math.max((i ?? buckets.length) - 1, 0));
    else return;
    e.preventDefault();
  };

  const activeBucket = active !== null ? buckets[active] : undefined;
  const activeX = active !== null ? PAD.left + active * slot + slot / 2 : 0;

  return (
    <Box ref={ref} pos="relative" style={{ width: '100%' }}>
      {width > 0 && (
        <svg width={width} height={HEIGHT} role="img" aria-label={label}>
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={PAD.top + plotH - f * plotH}
                y2={PAD.top + plotH - f * plotH}
                stroke="var(--mantine-color-default-border)"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={PAD.top + plotH - f * plotH}
                dy="0.32em"
                textAnchor="end"
                fontSize={11}
                fill="var(--mantine-color-dimmed)"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {formatInteger(Math.round(f * yMax))}
              </text>
            </g>
          ))}
          {buckets.map((b, i) => {
            const bx = PAD.left + i * slot + (slot - barW) / 2;
            let base = PAD.top + plotH;
            const visible = keys.filter((k) => (b.values[k.key] || 0) > 0);
            return (
              <g key={b.time} opacity={active === null || active === i ? 1 : 0.55}>
                {visible.map((k, j) => {
                  const h = scale(b.values[k.key]);
                  const top = j === visible.length - 1;
                  // Espaco de 2 px entre segmentos (cor da superficie), sem invadir a base.
                  const segH = Math.max(h - (j > 0 ? GAP : 0), 1);
                  const y = base - h;
                  base = y;
                  return top ? (
                    <path key={k.key} d={topRoundedRect(bx, y, barW, segH, RADIUS)} fill={k.color} />
                  ) : (
                    <rect key={k.key} x={bx} y={y} width={barW} height={segH} fill={k.color} />
                  );
                })}
                {i % tickEvery === 0 && (
                  <text x={PAD.left + i * slot + slot / 2} y={HEIGHT - 8} textAnchor="middle" fontSize={11} fill="var(--mantine-color-dimmed)">
                    {tickFormat.format(new Date(b.time))}
                  </text>
                )}
                <rect
                  x={PAD.left + i * slot}
                  y={PAD.top}
                  width={slot}
                  height={plotH}
                  fill="transparent"
                  onPointerEnter={() => setActive(i)}
                  onPointerLeave={() => setActive(null)}
                />
              </g>
            );
          })}
          <rect
            x={PAD.left}
            y={HEIGHT - PAD.bottom}
            width={plotW}
            height={1}
            fill="transparent"
            tabIndex={0}
            aria-label="Use as setas para percorrer as horas"
            onFocus={() => setActive((i) => i ?? buckets.length - 1)}
            onBlur={() => setActive(null)}
            onKeyDown={onKeyDown}
            style={{ outline: 'none' }}
          />
        </svg>
      )}
      {activeBucket && (
        <Paper
          withBorder
          shadow="sm"
          p={8}
          role="status"
          style={{
            position: 'absolute',
            top: PAD.top,
            left: Math.min(Math.max(activeX + 12, 0), Math.max(width - 190, 0)),
            pointerEvents: 'none',
            minWidth: 160,
          }}
        >
          <Text size="xs" c="dimmed" mb={4}>
            {fullFormat.format(new Date(activeBucket.time))}
          </Text>
          {[...keys].reverse().map((k) => (
            <Group key={k.key} gap={6} wrap="nowrap" justify="space-between">
              <Group gap={6} wrap="nowrap">
                <span aria-hidden style={{ width: 8, height: 8, borderRadius: 2, background: k.color, display: 'inline-block' }} />
                <Text size="xs">{k.label}</Text>
              </Group>
              <Text size="xs" fw={700} style={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatInteger(activeBucket.values[k.key] || 0)}
              </Text>
            </Group>
          ))}
        </Paper>
      )}
    </Box>
  );
}
