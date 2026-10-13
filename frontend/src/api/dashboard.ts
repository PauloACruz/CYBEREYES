import { api } from './client';
import type { DashboardOverview, DashboardOverviewParams } from './types';

export const dashboardApi = {
  overview: (params: DashboardOverviewParams) => api.get<DashboardOverview>('/api/dashboard/overview', { ...params }),
};
