import { Group, Text } from '@mantine/core';

export interface LegendItem {
  label: string;
  color: string;
}

/** Legenda das series: amostra de cor com o nome (a cor nunca aparece sozinha). */
export function ChartLegend({ items }: { items: LegendItem[] }) {
  return (
    <Group gap="md" wrap="wrap" role="list" aria-label="Legenda">
      {items.map((item) => (
        <Group key={item.label} gap={6} wrap="nowrap" role="listitem">
          <span aria-hidden style={{ width: 10, height: 10, borderRadius: 2, background: item.color, display: 'inline-block' }} />
          <Text size="xs" c="dimmed">
            {item.label}
          </Text>
        </Group>
      ))}
    </Group>
  );
}
