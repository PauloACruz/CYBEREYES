import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import type { AppRunDetail } from '../../api/types';
import { appRunsApi } from '../../api/webapps';
import { useConsoleHubConnection } from '../../realtime/consoleHubContext';

export interface LiveRun {
  run: AppRunDetail | undefined;
  /** Saida acumulada: a gravada no servidor mais os trechos recebidos ao vivo. */
  output: string;
  running: boolean;
  error: unknown;
}

/**
 * Acompanha uma execucao por SSH. O servidor grava a saida a cada 2 s e envia os trechos novos ao grupo da execucao
 * (appRunOutput com o deslocamento de cada trecho); aqui os dois se juntam sem duplicar. Sem conexao em tempo real,
 * a execucao em andamento e consultada a cada 2 s.
 */
export function useLiveRun(runId: number | null): LiveRun {
  const queryClient = useQueryClient();
  const { connection, connected } = useConsoleHubConnection();
  const [live, setLive] = useState<{ runId: number | null; text: string }>({ runId, text: '' });
  const liveRef = useRef(live);

  const query = useQuery({
    queryKey: queryKeys.appRun(runId ?? 0),
    queryFn: () => appRunsApi.get(runId ?? 0),
    enabled: runId !== null,
    refetchInterval: (q) => (q.state.data?.status === 'running' ? (connected ? 15_000 : 2_000) : false),
  });

  useEffect(() => {
    if (!connection || !connected || runId === null) return undefined;
    const key = queryKeys.appRun(runId);
    const refetch = () => void queryClient.invalidateQueries({ queryKey: key });
    const onOutput = (id: number, offset: number, text: string) => {
      if (id !== runId) return;
      const stored = queryClient.getQueryData<AppRunDetail>(key)?.output ?? '';
      const current = liveRef.current.runId === runId && liveRef.current.text.length > stored.length ? liveRef.current.text : stored;
      if (offset > current.length) {
        refetch();
        return;
      }
      if (offset + text.length <= current.length) return;
      const next = { runId, text: current + text.slice(current.length - offset) };
      liveRef.current = next;
      setLive(next);
    };
    const onFinished = (id: number) => {
      if (id === runId) refetch();
    };
    connection.on('appRunOutput', onOutput);
    connection.on('appRunFinished', onFinished);
    connection
      .invoke('JoinAppRun', runId)
      .then(refetch)
      .catch(() => undefined);
    return () => {
      connection.off('appRunOutput', onOutput);
      connection.off('appRunFinished', onFinished);
      connection.invoke('LeaveAppRun', runId).catch(() => undefined);
    };
  }, [connection, connected, runId, queryClient]);

  const stored = query.data?.output ?? '';
  const liveText = live.runId === runId ? live.text : '';
  return {
    run: query.data,
    output: liveText.length > stored.length ? liveText : stored,
    running: query.data?.status === 'running',
    error: query.error,
  };
}
