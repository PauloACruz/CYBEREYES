import { Tabs } from '@mantine/core';
import { IconCalendarTime, IconFileAnalytics, IconHistory } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { reportsApi } from '../../api/reports';
import { queryKeys } from '../../api/queryKeys';
import { PERMISSIONS } from '../../api/types';
import { hasPermission } from '../../auth/permissions';
import { useMe } from '../../auth/useMe';
import { PageHeader } from '../../components/PageHeader';
import { LoadError } from '../../components/TableStates';
import { ReportBuilder } from './ReportBuilder';
import { ReportRunsTab } from './ReportRunsTab';
import { ReportSchedulesTab } from './ReportSchedulesTab';

const TABS = ['gerar', 'historico', 'agendamentos'] as const;
type TabValue = (typeof TABS)[number];

function isTab(value: string | null): value is TabValue {
  return value !== null && (TABS as readonly string[]).includes(value);
}

export function ReportsPage() {
  const { data: me } = useMe();
  const canManage = hasPermission(me, PERMISSIONS.reportsManage);
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('aba');
  const tab: TabValue = isTab(requested) ? requested : 'gerar';
  const types = useQuery({ queryKey: queryKeys.reportTypes, queryFn: reportsApi.types, staleTime: 5 * 60_000 });

  const changeTab = (value: string | null) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (!value || value === 'gerar') next.delete('aba');
        else next.set('aba', value);
        return next;
      },
      { replace: true },
    );
  };

  return (
    <>
      <PageHeader title="Relatórios" description="Prévia, geração em PDF ou CSV e envio agendado por e-mail." />
      {types.isError && <LoadError error={types.error} onRetry={() => void types.refetch()} />}
      <Tabs value={tab} onChange={changeTab} keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="gerar" leftSection={<IconFileAnalytics size={16} />}>
            Gerar
          </Tabs.Tab>
          <Tabs.Tab value="historico" leftSection={<IconHistory size={16} />}>
            Histórico
          </Tabs.Tab>
          <Tabs.Tab value="agendamentos" leftSection={<IconCalendarTime size={16} />}>
            Agendamentos
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="gerar">
          <ReportBuilder types={types.data} loading={types.isPending} />
        </Tabs.Panel>
        <Tabs.Panel value="historico">
          <ReportRunsTab canManage={canManage} />
        </Tabs.Panel>
        <Tabs.Panel value="agendamentos">
          <ReportSchedulesTab types={types.data ?? []} canManage={canManage} />
        </Tabs.Panel>
      </Tabs>
    </>
  );
}
