import { useState } from 'react';
import { Grid, Stack, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import { PERMISSIONS, type AgentDetail } from '../../api/types';
import { careApi } from '../../api/care';
import { hasPermission } from '../../auth/permissions';
import { useMe } from '../../auth/useMe';
import { CatalogPanel } from './CatalogPanel';
import { HealthCard } from './HealthCard';
import { RunHistory } from './RunHistory';
import { RunPanel } from './RunPanel';
import { useRunChanged } from './careRuns';

export function CareTab({ agent }: { agent: AgentDetail }) {
  const { data: me } = useMe();
  const canRun = hasPermission(me, PERMISSIONS.careRun);
  const [runId, setRunId] = useState<string | null>(null);
  useRunChanged();
  // Mesma consulta do CatalogPanel (cache compartilhado) para mostrar os rotulos.
  const catalog = useQuery({
    queryKey: queryKeys.careCatalog(agent.id),
    queryFn: () => careApi.catalog(agent.id, { silent: true }),
    staleTime: 5 * 60_000,
  });

  return (
    <Grid gap="lg">
      <Grid.Col span={{ base: 12, lg: 7 }}>
        <Stack gap="lg">
          <section aria-labelledby="care-catalog-title">
            <Title order={5} id="care-catalog-title">
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
