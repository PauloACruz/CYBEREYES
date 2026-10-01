import { Badge, Group, Text, Tooltip } from '@mantine/core';
import type { AgentStatus } from '../../api/types';
import { formatDateTime, formatRelative } from '../../lib/format';
import { platformInfo, STATUS_INFO } from './agentFormat';

export function AgentStatusBadge({ status, size = 'sm' }: { status: AgentStatus; size?: 'sm' | 'md' | 'lg' }) {
  const info = STATUS_INFO[status];
  return (
    <Badge color={info.color} variant="light" size={size} leftSection={<info.icon size={12} aria-hidden />}>
      {info.label}
    </Badge>
  );
}

export function OperatingSystem({ plat, operatingSystem }: { plat: string; operatingSystem: string | null }) {
  const info = platformInfo(plat);
  return (
    <Group gap={6} wrap="nowrap">
      <info.icon size={16} aria-label={info.label} role="img" style={{ flexShrink: 0 }} />
      <Text size="sm" lineClamp={1}>
        {operatingSystem || info.label}
      </Text>
    </Group>
  );
}

export function RelativeTime({ value }: { value: string | null }) {
  if (!value) {
    return (
      <Text size="sm" c="dimmed" span>
        Nunca
      </Text>
    );
  }
  return (
    <Tooltip label={formatDateTime(value)} withArrow>
      <Text size="sm" span component="time" dateTime={value}>
        {formatRelative(value)}
      </Text>
    </Tooltip>
  );
}
