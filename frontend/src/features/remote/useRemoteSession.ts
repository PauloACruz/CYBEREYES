import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ApiError } from '../../api/client';
import { remoteApi } from '../../api/remote';
import type { RemoteChannel, RemoteSessionDto } from '../../api/types';
import { RemoteConnection, relayUrl, type ConnectionHandlers, type ConnectionPhase } from './connection';

export interface RemoteSessionOptions {
  channels: RemoteChannel[];
  viewOnly: boolean;
  ticketId: number | null;
}

export type SessionStatus =
  | { kind: 'creating' }
  | { kind: 'open'; phase: ConnectionPhase; session: RemoteSessionDto }
  | { kind: 'failed'; message: string }
  | { kind: 'ended'; message: string };

/** Mensagem amigavel para os erros da criacao de sessao (contrato, secao 2.3). */
export function createErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return error instanceof Error ? error.message : 'Não foi possível abrir o acesso remoto.';
  switch (error.code) {
    case 'REMOTE_DISABLED':
      return 'O acesso remoto está desligado no servidor.';
    case 'AGENT_OFFLINE':
      return 'A máquina está desconectada.';
    case 'REMOTE_UNSUPPORTED':
      return error.title;
    case 'SESSION_LIMIT':
      return 'Já existe um acesso remoto aberto nesta máquina ou você atingiu o limite de sessões.';
    case 'NO_INTERACTIVE_SESSION':
      return 'Não há usuário conectado na máquina.';
    case 'AGENT_TIMEOUT':
      return 'A máquina não respondeu a tempo.';
    default:
      return error.title;
  }
}

// Encerramento da sessao anterior: o StrictMode monta o efeito duas vezes em desenvolvimento, e a segunda
// criacao so pode comecar depois que a primeira sessao foi encerrada (limite de uma tela por maquina).
let teardown: Promise<void> = Promise.resolve();

/** Cria a sessao, conecta ao relay e encerra tudo ao sair. */
export function useRemoteSession(agentId: number, options: RemoteSessionOptions, handlers: Omit<ConnectionHandlers, 'onPhase' | 'onClosed'>) {
  const [status, setStatus] = useState<SessionStatus>({ kind: 'creating' });
  const connection = useRef<RemoteConnection | null>(null);
  const handlersRef = useRef(handlers);
  useLayoutEffect(() => {
    handlersRef.current = handlers;
  });
  const { channels, viewOnly, ticketId } = options;
  const channelKey = channels.join(',');

  useEffect(() => {
    // A limpeza aborta depois dos await; o sinal evita atualizar estado de uma sessao descartada.
    const controller = new AbortController();
    const cancelled = () => controller.signal.aborted;
    let created: RemoteSessionDto | null = null;
    const run = teardown.then(async () => {
      if (cancelled()) return;
      try {
        created = await remoteApi.createSession(agentId, { channels: channelKey.split(',') as RemoteChannel[], viewOnly, ticketId });
      } catch (error) {
        if (!cancelled()) setStatus({ kind: 'failed', message: createErrorMessage(error) });
        return;
      }
      if (cancelled()) return;
      const session = created;
      setStatus({ kind: 'open', phase: 'connecting', session });
      if (!session.channels.includes('desktop')) return;
      const conn = new RemoteConnection(relayUrl(session.sessionId), session.viewerToken ?? '', {
        onPhase: (phase) => setStatus((prev) => (prev.kind === 'open' ? { ...prev, phase } : prev)),
        onClosed: (message) => setStatus({ kind: 'ended', message }),
        onHello: (h) => handlersRef.current.onHello(h),
        onDisplays: (d, a) => handlersRef.current.onDisplays(d, a),
        onTile: (t) => handlersRef.current.onTile(t),
        onFrameEnd: (e) => handlersRef.current.onFrameEnd(e),
        onConsent: (s) => handlersRef.current.onConsent(s),
        onClipboard: (c) => handlersRef.current.onClipboard(c),
        onFilesCopied: (f) => handlersRef.current.onFilesCopied(f),
        onError: (code, message) => handlersRef.current.onError(code, message),
      });
      connection.current = conn;
      conn.connect();
    });
    return () => {
      controller.abort();
      teardown = run.then(async () => {
        connection.current?.close();
        connection.current = null;
        if (created) await remoteApi.endSession(created.sessionId).catch(() => undefined);
      });
    };
  }, [agentId, channelKey, viewOnly, ticketId]);

  return { status, connection };
}
