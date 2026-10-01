import { Badge } from '@mantine/core';
import type { LogLevel } from '../../api/types';
import { LOG_LEVEL_INFO } from './logFormat';

export function LogLevelBadge({ level }: { level: LogLevel }) {
  const info = LOG_LEVEL_INFO[level];
  return (
    <Badge color={info.color} variant={info.variant} size="sm" leftSection={<info.icon size={12} aria-hidden />}>
      {info.label}
    </Badge>
  );
}
