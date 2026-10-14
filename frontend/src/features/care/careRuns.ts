import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import type { CareRunDto } from '../../api/types';
import { useConsoleHubConnection } from '../../realtime/consoleHubContext';
import { applyRunChanged } from './runEvents';

/** careRunChanged (para todos): atualiza listas e a execucao aberta. */
export function useRunChanged() {
  const queryClient = useQueryClient();
  const { connection } = useConsoleHubConnection();
  useEffect(() => {
    if (!connection) return;
    const onChanged = (run: CareRunDto) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.careRunLists });
      queryClient.setQueryData<CareRunDto>(queryKeys.careRun(run.runId), (prev) => (prev ? applyRunChanged(prev, run) : prev));
    };
    connection.on('careRunChanged', onChanged);
    return () => connection.off('careRunChanged', onChanged);
  }, [connection, queryClient]);
}

/** Guarda a execucao recem-iniciada no cache para o painel abrir sem esperar a API. */
export function storeStartedRun(queryClient: QueryClient, run: CareRunDto): void {
  queryClient.setQueryData(queryKeys.careRun(run.runId), { ...run, events: run.events ?? [] });
  void queryClient.invalidateQueries({ queryKey: queryKeys.careRunLists });
}

