import { createContext, useContext } from 'react';
import type { HubConnection } from '@microsoft/signalr';

export interface ConsoleHubState {
  /** Conexao unica com /hubs/console; null antes do login com 2FA. */
  connection: HubConnection | null;
  connected: boolean;
}

export const ConsoleHubContext = createContext<ConsoleHubState>({ connection: null, connected: false });

export function useConsoleHubConnection(): ConsoleHubState {
  return useContext(ConsoleHubContext);
}
