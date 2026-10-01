import { ActionIcon, Code, CopyButton, Group, Tooltip } from '@mantine/core';
import { IconCheck, IconCopy } from '@tabler/icons-react';

interface CopyFieldProps {
  value: string;
  display?: string;
  label?: string;
}

export function CopyField({ value, display, label = 'Copiar' }: CopyFieldProps) {
  return (
    <Group gap="xs" wrap="nowrap" align="center">
      <Code fz="sm" style={{ wordBreak: 'break-all' }}>
        {display ?? value}
      </Code>
      <CopyButton value={value} timeout={2000}>
        {({ copied, copy }) => (
          <Tooltip label={copied ? 'Copiado' : label} withArrow position="right">
            <ActionIcon color={copied ? 'teal' : 'gray'} variant="subtle" onClick={copy} aria-label={label}>
              {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
            </ActionIcon>
          </Tooltip>
        )}
      </CopyButton>
    </Group>
  );
}
