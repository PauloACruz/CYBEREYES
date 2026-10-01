import { useEffect } from 'react';
import { HttpTransportType, HubConnectionBuilder, LogLevel } from '@microsoft/signalr';
import { useQueryClient } from '@tanstack/react-query';
import type { AgentStatusChangedEvent } from '../api/types';
import { useMe } from '../auth/useMe';
import { applyAgentStatusChange, refreshAgentData } from './agentCache';

const HUB_URL = '/hubs/console';
const START_RETRY_MS = 10_000;

function reconnectDelay(previousRetryCount: number): number {
  return Math.min(30_000, 1_000 * 2 ** previousRetryCount);
}

/**
 * Mantem a conexao com o hub do console enquanto ha sessao com 2FA validado.
 * Somente WebSockets: a API roda com varias replicas atras do Nginx.
 */
export function useConsoleHub(): void {
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const enabled = me?.mfaSatisfied === true;

  useEffect(() => {
    if (!enabled) return;
    const connection = new HubConnectionBuilder()
      .withUrl(new URL(HUB_URL, window.location.origin).href, { skipNegotiation: true, transport: HttpTransportType.WebSockets })
      .withAutomaticReconnect({ nextRetryDelayInMilliseconds: (ctx) => reconnectDelay(ctx.previousRetryCount) })
      .configureLogging(LogLevel.Warning)
      .build();

    connection.on('agentStatusChanged', (event: AgentStatusChangedEvent) => applyAgentStatusChange(queryClient, event));
    connection.on('agentsChanged', () => void refreshAgentData(queryClient));
    // Eventos perdidos durante a queda: recarregar o que esta em tela.
    connection.onreconnected(() => void refreshAgentData(queryClient));

    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const start = async () => {
      try {
        await connection.start();
      } catch {
        if (!disposed) retryTimer = setTimeout(() => void start(), START_RETRY_MS);
      }
    };
    void start();

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      void connection.stop();
    };
  }, [enabled, queryClient]);
}
