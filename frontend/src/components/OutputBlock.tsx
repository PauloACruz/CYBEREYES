import { Code, ScrollArea, Text } from '@mantine/core';

interface OutputBlockProps {
  label: string;
  value: string;
  emptyText?: string;
  maxHeight?: number;
  color?: string;
}

/** Saida de comando em fonte monoespacada, preservando quebras de linha. */
export function OutputBlock({ label, value, emptyText = 'Sem saída.', maxHeight = 420, color }: OutputBlockProps) {
  return (
    <div>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb={4}>
        {label}
      </Text>
      <ScrollArea.Autosize mah={maxHeight} type="auto">
        <Code block aria-label={label} c={color} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {value || emptyText}
        </Code>
      </ScrollArea.Autosize>
    </div>
  );
}
