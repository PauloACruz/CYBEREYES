import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { queryKeys } from '../api/queryKeys';
import { applyAlertsChanged } from './alertCache';

describe('applyAlertsChanged', () => {
  it('atualiza o contador e indica quando chegou um alerta novo', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.activeAlertCount, 3);

    expect(applyAlertsChanged(queryClient, { activeCount: 5 })).toBe(true);
    expect(queryClient.getQueryData(queryKeys.activeAlertCount)).toBe(5);

    expect(applyAlertsChanged(queryClient, { activeCount: 4 })).toBe(false);
    expect(queryClient.getQueryData(queryKeys.activeAlertCount)).toBe(4);
  });

  it('não indica alerta novo antes da carga inicial do contador', () => {
    const queryClient = new QueryClient();

    expect(applyAlertsChanged(queryClient, { activeCount: 2 })).toBe(false);
    expect(queryClient.getQueryData(queryKeys.activeAlertCount)).toBe(2);
  });

  it('marca as listas de alertas para recarregar', () => {
    const queryClient = new QueryClient();
    const params = { status: 'active' as const, page: 1, pageSize: 50 };
    queryClient.setQueryData(queryKeys.alertList(params), { items: [], total: 0, page: 1, pageSize: 50 });

    applyAlertsChanged(queryClient, { activeCount: 1 });

    expect(queryClient.getQueryState(queryKeys.alertList(params))?.isInvalidated).toBe(true);
  });
});
