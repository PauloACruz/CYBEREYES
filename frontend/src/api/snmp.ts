import { api, type RequestOptions } from './client';
import type {
  ListSnmpDevicesParams,
  SaveSnmpDeviceRequest,
  SaveSnmpSensorRequest,
  SnmpCollectorDto,
  SnmpDeviceDetail,
  SnmpDeviceDto,
  SnmpMetricDto,
  SnmpSensorDto,
  SnmpTestResult,
} from './types';

type Silent = Pick<RequestOptions, 'silent'>;

export interface SnmpMetricParams {
  metric: string;
  from: string;
  to: string;
}

export const snmpApi = {
  devices: (params: ListSnmpDevicesParams = {}, options?: Silent) => api.get<SnmpDeviceDto[]>('/api/snmp/devices', { ...params }, options),
  device: (id: number) => api.get<SnmpDeviceDetail>(`/api/snmp/devices/${id}`),
  create: (body: SaveSnmpDeviceRequest) => api.post<SnmpDeviceDto>('/api/snmp/devices', body),
  update: (id: number, body: SaveSnmpDeviceRequest) => api.put<SnmpDeviceDto>(`/api/snmp/devices/${id}`, body),
  remove: (id: number) => api.delete(`/api/snmp/devices/${id}`),
  /** O id (edicao) vai junto para o servidor poder usar as credenciais salvas quando as senhas vierem vazias. */
  test: (body: SaveSnmpDeviceRequest & { id?: number }) => api.post<SnmpTestResult>('/api/snmp/devices/test', body, { silent: true }),
  setInterfaceMonitored: (id: number, index: number, monitored: boolean) =>
    api.put(`/api/snmp/devices/${id}/interfaces/${index}`, { monitored }),
  createSensor: (id: number, body: SaveSnmpSensorRequest) => api.post<SnmpSensorDto>(`/api/snmp/devices/${id}/sensors`, body),
  updateSensor: (id: number, sensorId: number, body: SaveSnmpSensorRequest) =>
    api.put<SnmpSensorDto>(`/api/snmp/devices/${id}/sensors/${sensorId}`, body),
  removeSensor: (id: number, sensorId: number) => api.delete(`/api/snmp/devices/${id}/sensors/${sensorId}`),
  metrics: (id: number, params: SnmpMetricParams) => api.get<SnmpMetricDto>(`/api/snmp/devices/${id}/metrics`, { ...params }),
  collectors: (options?: Silent) => api.get<SnmpCollectorDto[]>('/api/snmp/collectors', undefined, options),
  setCollector: (agentId: number, enabled: boolean) => api.put(`/api/agents/${agentId}/snmp-collector`, { enabled }),
};
