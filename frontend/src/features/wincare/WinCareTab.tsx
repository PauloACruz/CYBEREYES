import { useEffect, useState } from 'react';
import { Grid, Stack, Text, Title } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import { PERMISSIONS, type AgentDetail, type WinCareRunDto } from '../../api/types';
import { wincareApi } from '../../api/wincare';
import { hasPermission } from '../../auth/permissions';
import { useMe } from '../../auth/useMe';
import { useConsoleHubConnection } from '../../realtime/consoleHubContext';
import { CatalogPanel } from './CatalogPanel';
import { HealthCard } from './HealthCard';
import { RunHistory } from './RunHistory';
import { RunPanel } from './RunPanel';
import { applyRunChanged } from './runEvents';

/** wincareRunChanged (para todos): atualiza listas e a execucao aberta. */
function useRunChanged() {
  const queryClient = useQueryClient();
  const { connection } = useConsoleHubConnection();
  useEffect(() => {
    if (!connection) return;
    const onChanged = (run: WinCareRunDto) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.wincareRunLists });
      queryClient.setQueryData<WinCareRunDto>(queryKeys.wincareRun(run.runId), (prev) => (prev ? applyRunChanged(prev, run) : prev));
    };
    connection.on('wincareRunChanged', onChanged);
    return () => connection.off('wincareRunChanged', onChanged);
  }, [connection, queryClient]);
}

export function WinCareTab({ agent }: { agent: AgentDetail }) {
  const { data: me } = useMe();
  const canRun = hasPermission(me, PERMISSIONS.wincareRun);
  const [runId, setRunId] = useState<string | null>(null);
  useRunChanged();
  // Mesma consulta do CatalogPanel (cache compartilhado) para mostrar os rotulos.
  const catalog = useQuery({
    queryKey: queryKeys.wincareCatalog(agent.id),
    queryFn: () => wincareApi.catalog(agent.id, { silent: true }),
    staleTime: 5 * 60_000,
  });

  return (
    <Grid gap="lg">
      <Grid.Col span={{ base: 12, lg: 7 }}>
        <Stack gap="lg">
          <section aria-labelledby="wincare-catalog-title">
            <Title order={5} id="wincare-catalog-title">
              Módulos de manutenção
            </Title>
            <Text size="sm" c="dimmed" mb="sm">
              Catálogo informado pelo agente instalado nesta máquina.
            </Text>
            <CatalogPanel agentId={agent.id} canRun={canRun} onStarted={(run) => setRunId(run.runId)} />
          </section>
          <RunHistory agentId={agent.id} catalog={catalog.data} selectedRunId={runId} onSelect={setRunId} />
        </Stack>
      </Grid.Col>
      <Grid.Col span={{ base: 12, lg: 5 }}>
        <Stack gap="lg">
          <HealthCard agentId={agent.id} />
          {runId ? (
            <RunPanel key={runId} runId={runId} catalog={catalog.data} canRun={canRun} />
          ) : (
            <Text size="sm" c="dimmed">
              Execute tarefas ou escolha uma execução no histórico para acompanhar o andamento.
            </Text>
          )}
        </Stack>
      </Grid.Col>
    </Grid>
  );
}
