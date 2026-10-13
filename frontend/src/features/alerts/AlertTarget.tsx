import { Anchor, Text } from '@mantine/core';
import { Link } from 'react-router';
import type { AlertDto } from '../../api/types';
import { agentPath, snmpDevicePath, webAppPath } from '../../app/paths';

/** Nome da maquina (com link para a aba do agente), do dispositivo SNMP ou da aplicacao web do alerta. */
export function AlertTarget({ alert, agentTab }: { alert: AlertDto; agentTab: string }) {
  if (alert.agentId !== null) {
    return (
      <Anchor component={Link} to={`${agentPath(alert.agentId)}?aba=${agentTab}`} size="sm" fw={500} style={{ flexShrink: 0 }}>
        {alert.hostname ?? `Agente ${alert.agentId}`}
      </Anchor>
    );
  }
  if (alert.webAppId) {
    return (
      <Anchor component={Link} to={webAppPath(alert.webAppId)} size="sm" fw={500} style={{ flexShrink: 0 }}>
        {alert.webAppName ?? `Aplicação ${alert.webAppId}`}
      </Anchor>
    );
  }
  const deviceId = alert.snmpDeviceId ?? null;
  const name = alert.deviceName ?? alert.hostname ?? (deviceId !== null ? `Dispositivo ${deviceId}` : 'Dispositivo SNMP');
  if (deviceId !== null) {
    return (
      <Anchor component={Link} to={snmpDevicePath(deviceId)} size="sm" fw={500} style={{ flexShrink: 0 }}>
        {name}
      </Anchor>
    );
  }
  return (
    <Text size="sm" fw={500} span style={{ flexShrink: 0 }}>
      {name}
    </Text>
  );
}
