import { Badge } from '@mantine/core';
import type { SnmpStatus } from '../../api/types';
import { SNMP_STATUS_INFO } from './snmpFormat';

export function SnmpStatusBadge({ status, size = 'sm' }: { status: SnmpStatus; size?: 'sm' | 'md' }) {
  const info = SNMP_STATUS_INFO[status];
  return (
    <Badge color={info.color} variant="light" size={size} leftSection={<info.icon size={12} aria-hidden />}>
      {info.label}
    </Badge>
  );
}
