import { Tabs } from '@mantine/core';
import { IconList, IconRobot } from '@tabler/icons-react';
import { useSearchParams } from 'react-router';
import { PageHeader } from '../../components/PageHeader';
import { LogInsightsPanel } from './insights/LogInsightsPanel';
import { LogsView } from './LogsView';

export function LogsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('aba') === 'analises' ? 'analises' : 'eventos';
  const selected = Number(searchParams.get('analise'));

  const update = (next: Record<string, string | null>) => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(next)) {
          if (value) params.set(key, value);
          else params.delete(key);
        }
        return params;
      },
      { replace: true },
    );
  };

  return (
    <>
      <PageHeader title="Logs" description="Eventos de sistema das máquinas, traps dos dispositivos SNMP e as análises do assistente de IA." />
      <Tabs value={tab} onChange={(v) => update({ aba: v === 'analises' ? 'analises' : null, analise: null })} keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="eventos" leftSection={<IconList size={16} />}>
            Eventos
          </Tabs.Tab>
          <Tabs.Tab value="analises" leftSection={<IconRobot size={16} />}>
            Análises da IA
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="eventos">
          <LogsView />
        </Tabs.Panel>
        <Tabs.Panel value="analises">
          <LogInsightsPanel
            selectedId={Number.isInteger(selected) && selected > 0 ? selected : undefined}
            onSelect={(id) => update({ analise: String(id) })}
          />
        </Tabs.Panel>
      </Tabs>
    </>
  );
}
