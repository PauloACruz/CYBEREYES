import { Badge } from '@mantine/core';
import type { AppRunStatus, WebAppStatus } from '../../api/types';
import { RUN_STATUS_INFO, WEBAPP_STATUS_INFO } from './webappFormat';

export function WebAppStatusBadge({ status, size = 'sm' }: { status: WebAppStatus; size?: 'sm' | 'md' }) {
  const info = WEBAPP_STATUS_INFO[status];
  return (
    <Badge color={info.color} variant={status === 'down' ? 'filled' : 'light'} size={size} leftSection={<info.icon size={12} aria-hidden />}>
      {info.label}
    </Badge>
  );
}

export function RunStatusBadge({ status }: { status: AppRunStatus }) {
  const info = RUN_STATUS_INFO[status];
  return (
    <Badge color={info.color} variant="light" size="sm">
      {info.label}
    </Badge>
  );
}
