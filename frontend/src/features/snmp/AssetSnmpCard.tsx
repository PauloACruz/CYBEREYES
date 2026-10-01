import { Anchor, Group, Stack, Text } from '@mantine/core';
import { IconRouter } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { queryKeys } from '../../api/queryKeys';
import { snmpApi } from '../../api/snmp';
import { snmpDevicePath } from '../../app/paths';
import { formatDuration, formatRelative } from '../../lib/format';
import { SheetCard } from '../inventory/sheetDisplay';
import { SnmpStatusBadge } from './SnmpStatusBadge';

/** Card "SNMP" da ficha do ativo; aparece so quando algum dispositivo aponta para o ativo. */
export function AssetSnmpCard({ assetId, clientId }: { assetId: number; clientId: number }) {
  const devices = useQuery({
    queryKey: queryKeys.snmpDevices({ clientId }),
    queryFn: () => snmpApi.devices({ clientId }, { silent: true }),
  });
  const linked = (devices.data ?? []).filter((d) => d.assetId === assetId);
  if (linked.length === 0) return null;

  return (
    <SheetCard id={`snmp-${assetId}-title`} title="SNMP" icon={IconRouter}>
      <Stack gap="sm">
        {linked.map((d) => (
          <div key={d.id}>
            <Group justify="space-between" wrap="nowrap" gap="xs">
              <Anchor component={Link} to={snmpDevicePath(d.id)} size="sm" fw={500}>
                {d.name}
              </Anchor>
              <SnmpStatusBadge status={d.status} />
            </Group>
            <Text size="xs" c="dimmed">
              {d.host} · uptime {formatDuration(d.uptimeSeconds)} · interfaces fora {d.interfacesDown}/{d.interfaceCount}
            </Text>
            <Text size="xs" c="dimmed">
              Última coleta: {formatRelative(d.lastPolledAt)}
            </Text>
          </div>
        ))}
      </Stack>
    </SheetCard>
  );
}
