import { Group, Paper, Text, Title } from '@mantine/core';
import type { Icon } from '@tabler/icons-react';
import type { ReactNode } from 'react';

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text size="sm" component="div" mt={2} style={{ wordBreak: 'break-word' }}>
        {children}
      </Text>
    </div>
  );
}

export function Missing({ text = 'Não informado' }: { text?: string }) {
  return (
    <Text size="sm" c="dimmed" span>
      {text}
    </Text>
  );
}

interface SheetCardProps {
  id: string;
  title: string;
  icon: Icon;
  actions?: ReactNode;
  children: ReactNode;
}

/** Card da ficha do ativo com titulo, icone e acoes opcionais. */
export function SheetCard({ id, title, icon: CardIcon, actions, children }: SheetCardProps) {
  return (
    <Paper withBorder p="md" component="section" aria-labelledby={id} className="sheet-card">
      <Group justify="space-between" mb="sm" wrap="nowrap" gap="xs">
        <Group gap={8} wrap="nowrap">
          <CardIcon size={18} stroke={1.6} color="var(--mantine-color-dimmed)" aria-hidden />
          <Title order={5} id={id}>
            {title}
          </Title>
        </Group>
        {actions && (
          <Group gap="xs" className="no-print">
            {actions}
          </Group>
        )}
      </Group>
      {children}
    </Paper>
  );
}
