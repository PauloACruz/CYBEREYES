import { useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Box, Group, Paper, Text } from '@mantine/core';
import { useElementSize } from '@mantine/hooks';
import { fullFormat, niceMax, tickFormatFor } from './chartScale';
import './charts.css';

const HEIGHT = 220;
const PAD = { top: 12, right: 16, bottom: 28, left: 64 };
const Y_STEPS = [0, 0.25, 0.5, 0.75, 1];

export interface TimeSeries {
  key: string;
  label: string;
  /** Cor da linha (variavel CSS de charts.css ou do Mantine). */
  color: string;
  points: { time: string; value: number }[];
}

export interface ChartThreshold {
  value: number;
  label: string;
  color: string;
}

interface TimeSeriesChartProps {
  series: TimeSeries[];
  formatValue: (value: number) => string;
  /** Rotulo acessivel do grafico. */
  label: string;
  thresholds?: ChartThreshold[];
}

/**
 * Linhas no tempo com um unico eixo Y comecando em zero, linha guia e dica ao passar o mouse
 * (ou com as setas do teclado). A legenda fica com quem chama quando ha mais de uma serie.
 */
export function TimeSeriesChart({ series, formatValue, label, thresholds = [] }: TimeSeriesChartProps) {
  const { ref, width } = useElementSize();
  const [active, setActive] = useState<number | null>(null);

  const times = [...new Set(series.flatMap((s) => s.points.map((p) => new Date(p.time).getTime())))].sort((a, b) => a - b);
  const byTime = series.map((s) => new Map(s.points.map((p) => [new Date(p.time).getTime(), p.value])));
  const first = times[0] ?? 0;
  const last = times[times.length - 1] ?? first;
  const span = Math.max(last - first, 1);
  const values = series.flatMap((s) => s.points.map((p) => p.value));
  const yMax = niceMax(Math.max(0, ...values, ...thresholds.map((t) => t.value)));
  const plotW = Math.max(width - PAD.left - PAD.right, 1);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (t: number) => PAD.left + (times.length <= 1 ? plotW / 2 : ((t - first) / span) * plotW);
  const y = (v: number) => PAD.top + plotH - (Math.min(Math.max(v, 0), yMax) / yMax) * plotH;
  const tickFormat = tickFormatFor(span);
  const xTicks = times.length > 1 ? [0, 0.25, 0.5, 0.75, 1].map((f) => first + f * span) : [first];

  const nearest = (px: number) => {
    let best = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    times.forEach((t, i) => {
      const d = Math.abs(x(t) - px);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return best;
  };

  const onPointerMove = (e: PointerEvent<SVGRectElement>) => {
    const svg = e.currentTarget.ownerSVGElement;
    if (!svg) return;
    setActive(nearest(e.clientX - svg.getBoundingClientRect().left));
  };

  const onKeyDown = (e: KeyboardEvent<SVGRectElement>) => {
    if (times.length === 0) return;
    if (e.key === 'ArrowRight') setActive((i) => Math.min((i ?? -1) + 1, times.length - 1));
    else if (e.key === 'ArrowLeft') setActive((i) => Math.max((i ?? times.length) - 1, 0));
    else return;
    e.preventDefault();
  };

  const activeTime = active !== null ? times[active] : undefined;
  const activeX = activeTime !== undefined ? x(activeTime) : 0;

  return (
    <Box ref={ref} pos="relative" style={{ width: '100%' }}>
      {width > 0 && (
        <svg width={width} height={HEIGHT} role="img" aria-label={label}>
          {Y_STEPS.map((f) => (
            <g key={f}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(f * yMax)} y2={y(f * yMax)} stroke="var(--mantine-color-default-border)" strokeWidth={1} />
              <text x={PAD.left - 8} y={y(f * yMax)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--mantine-color-dimmed)" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatValue(f * yMax)}
              </text>
            </g>
          ))}
          {xTicks.map((t, i) => (
            <text
              key={i}
              x={x(t)}
              y={HEIGHT - 8}
              textAnchor={i === 0 && xTicks.length > 1 ? 'start' : i === xTicks.length - 1 && xTicks.length > 1 ? 'end' : 'middle'}
              fontSize={11}
              fill="var(--mantine-color-dimmed)"
            >
              {tickFormat.format(new Date(t))}
            </text>
          ))}
          {thresholds.map((th) => (
            <g key={th.label}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(th.value)} y2={y(th.value)} stroke={th.color} strokeWidth={1} strokeDasharray="4 3" />
              <text x={width - PAD.right} y={y(th.value) - 4} textAnchor="end" fontSize={11} fill="var(--mantine-color-text)">
                {th.label} {formatValue(th.value)}
              </text>
            </g>
          ))}
          {series.map((s) => {
            const pts = s.points.map((p) => [x(new Date(p.time).getTime()), y(p.value)] as const);
            const d = pts.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
            return pts.length === 1 && pts[0] ? (
              <circle key={s.key} cx={pts[0][0]} cy={pts[0][1]} r={4} fill={s.color} />
            ) : (
              <path key={s.key} d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            );
          })}
          {activeTime !== undefined && (
            <g aria-hidden>
              <line x1={activeX} x2={activeX} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--mantine-color-dimmed)" strokeWidth={1} />
              {series.map((s, i) => {
                const v = byTime[i]?.get(activeTime);
                return v === undefined ? null : (
                  <circle key={s.key} cx={activeX} cy={y(v)} r={5} fill={s.color} stroke="var(--mantine-color-body)" strokeWidth={2} />
                );
              })}
            </g>
          )}
          <rect
            x={PAD.left}
            y={PAD.top}
            width={plotW}
            height={plotH}
            fill="transparent"
            tabIndex={0}
            aria-label="Use as setas para percorrer as leituras"
            onPointerMove={onPointerMove}
            onPointerLeave={() => setActive(null)}
            onFocus={() => setActive((i) => i ?? times.length - 1)}
            onBlur={() => setActive(null)}
            onKeyDown={onKeyDown}
            style={{ outline: 'none' }}
          />
        </svg>
      )}
      {activeTime !== undefined && (
        <Paper
          withBorder
          shadow="sm"
          p={8}
          role="status"
          style={{
            position: 'absolute',
            top: PAD.top,
            left: Math.min(Math.max(activeX + 12, 0), Math.max(width - 200, 0)),
            pointerEvents: 'none',
            minWidth: 170,
          }}
        >
          <Text size="xs" c="dimmed" mb={4}>
            {fullFormat.format(new Date(activeTime))}
          </Text>
          {series.map((s, i) => {
            const v = byTime[i]?.get(activeTime);
            return (
              <Group key={s.key} gap={6} wrap="nowrap" justify="space-between">
                <Group gap={6} wrap="nowrap">
                  <span aria-hidden style={{ width: 8, height: 8, borderRadius: 2, background: s.color, display: 'inline-block' }} />
                  <Text size="xs">{s.label}</Text>
                </Group>
                <Text size="xs" fw={700} style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {v === undefined ? 'Sem leitura' : formatValue(v)}
                </Text>
              </Group>
            );
          })}
        </Paper>
      )}
    </Box>
  );
}
