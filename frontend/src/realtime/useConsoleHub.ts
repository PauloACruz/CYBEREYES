import { useEffect, useMemo, useRef, useState } from 'react';
import { HttpTransportType, HubConnectionBuilder, LogLevel, type HubConnection } from '@microsoft/signalr';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../api/queryKeys';
import type { AgentStatusChangedEvent, AlertsChangedEvent, TicketsChangedEvent } from '../api/types';
import { useMe } from '../auth/useMe';
import { applyAgentStatusChange, refreshAgentData } from './agentCache';
import { handleAlertsChanged } from './alertCache';
import { applyTicketsChanged } from './ticketCache';
import type { ConsoleHubState } from './consoleHubContext';

const HUB_URL = '/hubs/console';
const START_RETRY_MS = 10_000;

function reconnectDelay(previousRetryCount: number): number {
  return Math.min(30_000, 1_000 * 2 ** previousRetryCount);
}

/**
 * Mantem a conexao com o hub do console enquanto ha sessao com 2FA validado.
 * Somente WebSockets: a API roda com varias replicas atras do Nginx.
 * A conexao e devolvida para ser compartilhada (terminal) via ConsoleHubContext.
 */
export function useConsoleHub(): ConsoleHubState {
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const enabled = me?.mfaSatisfied === true;
  const [connectedTo, setConnectedTo] = useState<HubConnection | null>(null);
  const stopping = useRef<Promise<void>>(Promise.resolve());

  // Montar a conexao nao abre rede; isso so acontece no start() do efeito abaixo.
  const connection = useMemo(() => {
    if (!enabled) return null;
    const conn = new HubConnectionBuilder()
      .withUrl(new URL(HUB_URL, window.location.origin).href, { skipNegotiation: true, transport: HttpTransportType.WebSockets })
      .withAutomaticReconnect({ nextRetryDelayInMilliseconds: (ctx) => reconnectDelay(ctx.previousRetryCount) })
      .configureLogging(LogLevel.Warning)
      .build();

    conn.on('agentStatusChanged', (event: AgentStatusChangedEvent) => applyAgentStatusChange(queryClient, event));
    conn.on('agentsChanged', () => void refreshAgentData(queryClient));
    conn.on('alertsChanged', (event: AlertsChangedEvent) => handleAlertsChanged(queryClient, event));
    conn.on('ticketsChanged', (event: TicketsChangedEvent) => applyTicketsChanged(queryClient, event));
    // Eventos perdidos durante a queda: recarregar o que esta em tela.
    conn.onreconnected(() => {
      setConnectedTo(conn);
      void refreshAgentData(queryClient);
      void queryClient.invalidateQueries({ queryKey: queryKeys.activeAlertCount });
      void queryClient.invalidateQueries({ queryKey: queryKeys.tickets });
    });
    conn.onreconnecting(() => setConnectedTo(null));
    conn.onclose(() => setConnectedTo(null));
    return conn;
  }, [enabled, queryClient]);

  useEffect(() => {
    if (!connection) return;
    let disposed = false;
    const isDisposed = () => disposed;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const start = async () => {
      try {
        await stopping.current;
        if (isDisposed()) return;
        await connection.start();
        if (!isDisposed()) setConnectedTo(connection);
      } catch {
        if (!disposed) retryTimer = setTimeout(() => void start(), START_RETRY_MS);
      }
    };
    void start();

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      stopping.current = connection.stop().catch(() => undefined);
    };
  }, [connection]);

  return { connection, connected: connection !== null && connectedTo === connection };
}
