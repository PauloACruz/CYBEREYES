import { Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { careApi } from '../../../api/care';
import { queryKeys } from '../../../api/queryKeys';
import { PERMISSIONS } from '../../../api/types';
import { MOBILE_PATHS, mobileCarePath } from '../../../app/paths';
import { hasPermission } from '../../../auth/permissions';
import { useMe } from '../../../auth/useMe';
import { CARE_NAME } from '../../care/careFormat';
import { useRunChanged } from '../../care/careRuns';
import { RunPanel } from '../../care/RunPanel';
import { MobileHeader, MobilePage } from '../MobilePage';

/** Execucao do Cybereyes Care em tempo real: progresso, tarefas, log e cancelar. */
export function MobileCareRunPage() {
  const { id: rawId, runId = '' } = useParams();
  const agentId = Number(rawId);
  const valid = Number.isInteger(agentId) && agentId > 0;
  const { data: me } = useMe();
  useRunChanged();
  const catalog = useQuery({
    queryKey: queryKeys.careCatalog(agentId),
    queryFn: () => careApi.catalog(agentId, { silent: true }),
    staleTime: 5 * 60_000,
    enabled: valid,
    retry: false,
  });
  const back = valid ? { to: mobileCarePath(agentId, 'historico'), label: CARE_NAME } : { to: MOBILE_PATHS.agents, label: 'Agentes' };

  return (
    <MobilePage header={<MobileHeader title={CARE_NAME} back={back} />}>
      {runId ? <RunPanel runId={runId} catalog={catalog.data} canRun={hasPermission(me, PERMISSIONS.careRun)} /> : null}
      <Text size="sm" c="var(--ce-text-secondary)">
        Pode sair desta tela: a execução continua na máquina e fica no histórico do {CARE_NAME}.
      </Text>
    </MobilePage>
  );
}
