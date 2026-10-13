import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Badge, Box, Button, Group, Paper, Stack, Text } from '@mantine/core';
import { IconAlertTriangle, IconPlayerPlay, IconPlayerStop, IconRefresh } from '@tabler/icons-react';
import type { HubConnection } from '@microsoft/signalr';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useConsoleHubConnection } from '../../realtime/consoleHubContext';
import { decodeBase64 } from './terminalCodec';

export type TerminalStatus = 'idle' | 'starting' | 'open' | 'closed';

function silence(promise: Promise<unknown>): void {
  promise.catch(() => undefined);
}

interface PendingChunk {
  sessionId: string;
  data: string;
}

interface HubTerminalProps {
  /** Rotulo acessivel da area do terminal. */
  label: string;
  /** Abre a sessao no hub (StartTerminal, StartSshTerminal...) e devolve o id dela. */
  start: (hub: HubConnection, cols: number, rows: number) => Promise<string>;
  /** Traduz a falha ao abrir para o tecnico. */
  startErrorMessage: (error: unknown) => string;
  /** Controles antes do botao de abrir (seletor de shell etc.); recebe o estado da sessao. */
  toolbar?: (status: TerminalStatus) => ReactNode;
  height?: number;
  /** Abre a sessao assim que o hub conectar. */
  autoStart?: boolean;
}

/**
 * Terminal xterm.js ligado ao hub do console. A saida chega como bytes em base64 (terminalOutput) e o fim como
 * terminalClosed; entrada, redimensionamento e encerramento usam TerminalInput, ResizeTerminal e StopTerminal,
 * os mesmos para o terminal do agente e o SSH.
 */
export function HubTerminal({ label, start, startErrorMessage, toolbar, height = 480, autoStart = false }: HubTerminalProps) {
  const { connection, connected } = useConsoleHubConnection();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<string | null>(null);
  const startingRef = useRef(false);
  const autoStartedRef = useRef(false);
  const pendingRef = useRef<PendingChunk[]>([]);
  const [status, setStatus] = useState<TerminalStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [sessionConnectionId, setSessionConnectionId] = useState<string | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
      fontSize: 14,
      scrollback: 5000,
      theme: { background: '#1a1b1e', foreground: '#e9ecef' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(element);
    const refit = () => {
      try {
        fit.fit();
      } catch {
        // elemento ainda sem tamanho (aba oculta): o proximo resize ajusta
      }
    };
    refit();
    termRef.current = term;
    fitRef.current = fit;
    const observer = new ResizeObserver(refit);
    observer.observe(element);
    return () => {
      observer.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  useEffect(() => {
    const term = termRef.current;
    if (!term || !connection) return;
    const hub: HubConnection = connection;

    const onOutput = (sessionId: string, data: string) => {
      if (sessionId === sessionRef.current) term.write(decodeBase64(data));
      else if (startingRef.current) pendingRef.current.push({ sessionId, data });
    };
    const onClosed = (sessionId: string, exitCode: number, reason: string | null) => {
      if (sessionId !== sessionRef.current) return;
      sessionRef.current = null;
      term.write('\r\n\x1b[33m[sessão encerrada]\x1b[0m\r\n');
      setStatus('closed');
      setMessage(reason ?? `O terminal foi encerrado (código ${exitCode}).`);
    };
    hub.on('terminalOutput', onOutput);
    hub.on('terminalClosed', onClosed);
    const dataSub = term.onData((data) => {
      const id = sessionRef.current;
      if (id) silence(hub.invoke('TerminalInput', id, data));
    });
    const resizeSub = term.onResize(({ cols, rows }) => {
      const id = sessionRef.current;
      if (id) silence(hub.invoke('ResizeTerminal', id, cols, rows));
    });

    return () => {
      dataSub.dispose();
      resizeSub.dispose();
      hub.off('terminalOutput', onOutput);
      hub.off('terminalClosed', onClosed);
      const id = sessionRef.current;
      sessionRef.current = null;
      if (id) silence(hub.invoke('StopTerminal', id));
    };
  }, [connection]);

  const open = async () => {
    const term = termRef.current;
    if (!connection || !connected || !term) return;
    setStatus('starting');
    setMessage(null);
    term.reset();
    try {
      fitRef.current?.fit();
    } catch {
      // mantem o tamanho atual
    }
    pendingRef.current = [];
    startingRef.current = true;
    try {
      const sessionId = await start(connection, term.cols, term.rows);
      sessionRef.current = sessionId;
      for (const chunk of pendingRef.current) {
        if (chunk.sessionId === sessionId) term.write(decodeBase64(chunk.data));
      }
      setSessionConnectionId(connection.connectionId);
      setStatus('open');
      term.focus();
    } catch (error) {
      setStatus('closed');
      setMessage(startErrorMessage(error));
    } finally {
      startingRef.current = false;
      pendingRef.current = [];
    }
  };

  const startRef = useRef(open);
  useEffect(() => {
    startRef.current = open;
  });
  useEffect(() => {
    if (!autoStart || !connected || autoStartedRef.current) return;
    autoStartedRef.current = true;
    void startRef.current();
  }, [autoStart, connected]);

  const stop = () => {
    const id = sessionRef.current;
    sessionRef.current = null;
    if (id && connection) silence(connection.invoke('StopTerminal', id));
    termRef.current?.write('\r\n\x1b[33m[sessão encerrada]\x1b[0m\r\n');
    setStatus('closed');
    setMessage('Você encerrou o terminal.');
  };

  // O servidor encerra as sessoes quando a conexao cai; apos reconectar o connectionId muda.
  const lost = status === 'open' && (!connected || connection?.connectionId !== sessionConnectionId);
  const effective: TerminalStatus = lost ? 'closed' : status;
  const shownMessage = lost ? 'A conexão com o servidor caiu e a sessão foi encerrada.' : message;

  return (
    <Stack>
      <Group justify="space-between" wrap="wrap">
        <Group gap="sm">
          {toolbar?.(effective)}
          {effective === 'open' ? (
            <Button color="red" variant="light" leftSection={<IconPlayerStop size={16} />} onClick={stop}>
              Encerrar
            </Button>
          ) : (
            <Button
              leftSection={effective === 'closed' ? <IconRefresh size={16} /> : <IconPlayerPlay size={16} />}
              loading={effective === 'starting'}
              disabled={!connected}
              onClick={() => void open()}
            >
              {effective === 'closed' ? 'Reabrir terminal' : 'Abrir terminal'}
            </Button>
          )}
        </Group>
        <Badge color={effective === 'open' ? 'teal' : 'gray'} variant="light">
          {effective === 'open' ? 'Conectado' : effective === 'starting' ? 'Conectando' : 'Desconectado'}
        </Badge>
      </Group>
      {!connected && (
        <Text size="sm" c="dimmed">
          Aguardando a conexão em tempo real com o servidor.
        </Text>
      )}
      {effective === 'closed' && shownMessage && (
        <Alert color="yellow" icon={<IconAlertTriangle size={18} />} title="Terminal encerrado">
          {shownMessage}
        </Alert>
      )}
      <Paper withBorder p={6} bg="#1a1b1e">
        <Box ref={containerRef} h={height} aria-label={label} role="region" />
      </Paper>
    </Stack>
  );
}
