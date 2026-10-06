import { remotePath } from '../../../app/paths';

/** Abre o visualizador de acesso remoto numa janela propria do console (RFC-001). */
export function openRemoteWindow(agentId: number, options: { viewOnly?: boolean; ticketId?: number } = {}): void {
  const win = window.open(remotePath(agentId, options), `cybereyes-remoto-${agentId}`, 'popup,width=1366,height=820');
  win?.focus();
}
