import type { DashboardPeriod } from '../../api/types';

export const PERIODS: readonly DashboardPeriod[] = [7, 14, 30];
export const DEFAULT_PERIOD: DashboardPeriod = 30;

export interface DashboardFilterValues {
  clientId?: number;
  technicianId?: string;
  days: DashboardPeriod;
}
