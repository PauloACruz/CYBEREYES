import { Badge, Group, Text, Tooltip } from '@mantine/core';
import type { AssetStatus, AssetType, IpKind } from '../../api/types';
import { ASSET_STATUS_INFO, ASSET_TYPE_INFO, IP_KIND_INFO } from './inventoryFormat';

export function AssetTypeIcon({ type, size = 18 }: { type: AssetType; size?: number }) {
  const info = ASSET_TYPE_INFO[type];
  return (
    <Tooltip label={info.label} withArrow>
      <info.icon size={size} stroke={1.6} role="img" aria-label={info.label} style={{ flexShrink: 0 }} />
    </Tooltip>
  );
}

export function AssetTypeLabel({ type }: { type: AssetType }) {
  const info = ASSET_TYPE_INFO[type];
  return (
    <Group gap={6} wrap="nowrap" component="span">
      <info.icon size={16} stroke={1.6} aria-hidden style={{ flexShrink: 0 }} />
      <Text size="sm" span>
        {info.label}
      </Text>
    </Group>
  );
}

export function AssetStatusBadge({ status, size = 'sm' }: { status: AssetStatus; size?: 'sm' | 'md' | 'lg' }) {
  const info = ASSET_STATUS_INFO[status];
  return (
    <Badge color={info.color} variant="light" size={size}>
      {info.label}
    </Badge>
  );
}

export function IpKindBadge({ kind }: { kind: IpKind }) {
  const info = (IP_KIND_INFO as Partial<Record<string, { label: string; color: string }>>)[kind] ?? { label: kind, color: 'gray' };
  return (
    <Badge color={info.color} variant="outline" size="sm">
      {info.label}
    </Badge>
  );
}
