import { api } from './client';
import type { AuditDto, ListAuditParams, Paged } from './types';

export const auditApi = {
  list: (params: ListAuditParams) => api.get<Paged<AuditDto>>('/api/audit', { ...params }),
};
