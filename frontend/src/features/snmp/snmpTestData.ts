import type { SnmpDeviceDetail, SnmpDeviceDto } from '../../api/types';

export function makeSnmpDevice(overrides: Partial<SnmpDeviceDto> = {}): SnmpDeviceDto {
  return {
    id: 5,
    clientId: 1,
    clientName: 'Clínica Central',
    siteId: 10,
    collectorAgentId: 1,
    collectorHostname: 'SRV-COLETOR',
    assetId: null,
    name: 'Switch recepção',
    host: '192.168.1.2',
    port: 161,
    version: 'v2c',
    interval: 300,
    enabled: true,
    trapSeverity: 'warning',
    status: 'up',
    lastPolledAt: '2026-10-01T10:00:00Z',
    lastError: null,
    sysName: 'SW-RECEPCAO',
    sysDescr: 'Switch gerenciável 24 portas',
    sysLocation: 'Rack térreo',
    sysContact: 'ti@clinica.example',
    uptimeSeconds: 93_784,
    hasCredentials: true,
    interfaceCount: 2,
    interfacesDown: 1,
    ...overrides,
  };
}

export function makeSnmpDetail(overrides: Partial<SnmpDeviceDetail> = {}): SnmpDeviceDetail {
  return {
    ...makeSnmpDevice(),
    interfaces: [
      {
        index: 1,
        name: 'Gi0/1',
        descr: 'GigabitEthernet0/1',
        alias: 'Uplink',
        type: 6,
        speedBps: 1_000_000_000,
        adminStatus: 'up',
        operStatus: 'up',
        inBps: 94_300_000,
        outBps: 1_500,
        inErrors: 0,
        outErrors: 2,
        lastAt: '2026-10-01T10:00:00Z',
        monitored: true,
      },
      {
        index: 2,
        name: 'Gi0/2',
        descr: 'GigabitEthernet0/2',
        alias: null,
        type: 6,
        speedBps: 100_000_000,
        adminStatus: 'up',
        operStatus: 'down',
        inBps: 0,
        outBps: 0,
        inErrors: 0,
        outErrors: 0,
        lastAt: '2026-10-01T10:00:00Z',
        monitored: false,
      },
    ],
    sensors: [],
    ...overrides,
  };
}
