import { Group, Paper, Text, ThemeIcon, Tooltip } from '@mantine/core';
import { IconId } from '@tabler/icons-react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { DeviceNode } from './diagramModel';
import { NODE_KIND_INFO } from './diagramModel';

const HANDLES = [
  { id: 'top', position: Position.Top },
  { id: 'right', position: Position.Right },
  { id: 'bottom', position: Position.Bottom },
  { id: 'left', position: Position.Left },
] as const;

/** No do diagrama: icone do tipo, nome e um ponto de conexao em cada lado. */
export function DeviceNodeView({ data, selected }: NodeProps<DeviceNode>) {
  const info = NODE_KIND_INFO[data.kind];
  return (
    <Paper
      withBorder
      shadow={selected ? 'md' : 'xs'}
      px="sm"
      py={6}
      miw={130}
      maw={220}
      style={{
        borderColor: selected ? `var(--mantine-color-${info.color}-6)` : undefined,
        borderWidth: selected ? 2 : 1,
      }}
    >
      {HANDLES.map((h) => (
        <Handle key={h.id} id={h.id} type="source" position={h.position} />
      ))}
      <Group gap={8} wrap="nowrap">
        <ThemeIcon variant="light" color={info.color} size={30} radius="md">
          <info.icon size={18} stroke={1.6} />
        </ThemeIcon>
        <div style={{ minWidth: 0 }}>
          <Text size="sm" fw={600} lineClamp={2} style={{ wordBreak: 'break-word' }}>
            {data.label || info.label}
          </Text>
          <Group gap={4} wrap="nowrap">
            <Text size="xs" c="dimmed">
              {info.label}
            </Text>
            {data.assetId !== undefined && (
              <Tooltip label="Ativo do inventário (duplo clique abre a ficha)" withArrow>
                <IconId size={12} color="var(--mantine-color-blue-6)" role="img" aria-label="Ativo do inventário" />
              </Tooltip>
            )}
          </Group>
        </div>
      </Group>
    </Paper>
  );
}
