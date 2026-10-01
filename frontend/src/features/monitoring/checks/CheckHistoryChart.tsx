import { useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Box, Paper, Text } from '@mantine/core';
import { useElementSize } from '@mantine/hooks';
import type { CheckHistoryPoint } from '../../../api/types';

const HEIGHT = 220;
const PAD = { top: 12, right: 16, bottom: 28, left: 44 };
const Y_TICKS = [0, 25, 50, 75, 100];

const timeFormat = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });
const fullFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

interface Threshold {
  value: number;
  label: string;
  color: string;
}

interface CheckHistoryChartProps {
  points: CheckHistoryPoint[];
  /** Descricao do valor, ex.: "Espaço livre" ou "Uso de CPU". */
  valueLabel: string;
  thresholds: Threshold[];
  /** Periodo em horas; define o formato do eixo de tempo. */
  hours: number;
}

/**
 * Linha unica de 0 a 100% com linhas de referencia dos limites. A legenda e o titulo
 * ficam com quem chama; os valores tambem aparecem na tabela (CheckHistoryTable).
 */
export function CheckHistoryChart({ points, valueLabel, thresholds, hours }: CheckHistoryChartProps) {
  const { ref, width } = useElementSize();
  const [active, setActive] = useState<number | null>(null);

  const times = points.map((p) => new Date(p.time).getTime());
  const first = times[0] ?? 0;
  const last = times[times.length - 1] ?? first;
  const span = Math.max(last - first, 1);
  const plotW = Math.max(width - PAD.left - PAD.right, 1);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (t: number) => PAD.left + (points.length === 1 ? plotW / 2 : ((t - first) / span) * plotW);
  const y = (v: number) => PAD.top + plotH - (Math.min(Math.max(v, 0), 100) / 100) * plotH;

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(times[i] ?? first).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = points.length > 1 ? `${path} L${x(last).toFixed(1)},${y(0)} L${x(first).toFixed(1)},${y(0)} Z` : '';
  const tickFormat = hours <= 24 ? timeFormat : dayFormat;
  const xTicks = points.length > 1 ? [0, 0.25, 0.5, 0.75, 1].map((f) => first + f * span) : [first];

  const nearest = (clientX: number, rectLeft: number) => {
    const px = clientX - rectLeft;
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
    setActive(nearest(e.clientX, svg.getBoundingClientRect().left));
  };

  const onKeyDown = (e: KeyboardEvent<SVGRectElement>) => {
    if (points.length === 0) return;
    if (e.key === 'ArrowRight') setActive((i) => Math.min((i ?? -1) + 1, points.length - 1));
    else if (e.key === 'ArrowLeft') setActive((i) => Math.max((i ?? points.length) - 1, 0));
    else return;
    e.preventDefault();
  };

  const activePoint = active !== null ? points[active] : undefined;
  const activeX = active !== null ? x(times[active] ?? first) : 0;

  return (
    <Box ref={ref} pos="relative" style={{ width: '100%' }}>
      {width > 0 && (
        <svg width={width} height={HEIGHT} role="img" aria-label={`Gráfico de ${valueLabel.toLowerCase()} no período`}>
          {Y_TICKS.map((tick) => (
            <g key={tick}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(tick)} y2={y(tick)} stroke="var(--mantine-color-default-border)" strokeWidth={1} />
              <text x={PAD.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--mantine-color-dimmed)" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {tick}%
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
          {thresholds
            .filter((th) => th.value > 0)
            .map((th) => (
              <g key={th.label}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(th.value)} y2={y(th.value)} stroke={th.color} strokeWidth={1} />
                <text x={width - PAD.right} y={y(th.value) - 4} textAnchor="end" fontSize={11} fill="var(--mantine-color-text)">
                  {th.label} {th.value}%
                </text>
              </g>
            ))}
          {area && <path d={area} fill="var(--mantine-color-blue-6)" fillOpacity={0.1} />}
          <path d={path} fill="none" stroke="var(--mantine-color-blue-6)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {points.map((p, i) =>
            p.status === 'failing' ? (
              <circle
                key={i}
                cx={x(times[i] ?? first)}
                cy={y(p.value)}
                r={4}
                fill="var(--mantine-color-red-6)"
                stroke="var(--mantine-color-body)"
                strokeWidth={2}
              />
            ) : null,
          )}
          {activePoint && (
            <g aria-hidden>
              <line x1={activeX} x2={activeX} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--mantine-color-dimmed)" strokeWidth={1} />
              <circle cx={activeX} cy={y(activePoint.value)} r={5} fill="var(--mantine-color-blue-6)" stroke="var(--mantine-color-body)" strokeWidth={2} />
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
            onFocus={() => setActive((i) => i ?? points.length - 1)}
            onBlur={() => setActive(null)}
            onKeyDown={onKeyDown}
            style={{ outline: 'none' }}
          />
        </svg>
      )}
      {activePoint && (
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
          <Text size="sm" fw={700}>
            {Math.round(activePoint.value)}%
          </Text>
          <Text size="xs" c="dimmed">
            {valueLabel} · {fullFormat.format(new Date(activePoint.time))}
          </Text>
          {activePoint.status === 'failing' && (
            <Text size="xs" c="dimmed">
              Leitura com falha
            </Text>
          )}
        </Paper>
      )}
    </Box>
  );
}
