import { useEffect, useRef, useState } from 'react';
import { Alert, Badge, Box, Button, Group, Paper, Select, Stack, Text } from '@mantine/core';
import { IconAlertTriangle, IconPlayerPlay, IconPlayerStop, IconRefresh } from '@tabler/icons-react';
import type { HubConnection } from '@microsoft/signalr';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { AGENT_TIMEOUT_TITLE } from '../../../api/client';
import type { AgentDetail } from '../../../api/types';
import { useConsoleHubConnection } from '../../../realtime/consoleHubContext';
import { isWindows } from './shells';
import { decodeBase64 } from './terminalCodec';

type Status = 'idle' | 'starting' | 'open' | 'closed';

const DEFAULT_SHELL = 'padrao';

function shellOptions(plat: string): { value: string; label: string }[] {
  return isWindows(plat)
    ? [
        { value: DEFAULT_SHELL, label: 'Padrão (cmd)' },
        { value: 'powershell', label: 'PowerShell' },
      ]
    : [
        { value: DEFAULT_SHELL, label: 'Padrão (/bin/bash)' },
        { value: '/bin/sh', label: '/bin/sh' },
        { value: '/bin/zsh', label: '/bin/zsh' },
      ];
}

function startErrorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : '';
  if (/AGENT_TIMEOUT|timed? ?out/i.test(text)) return `${AGENT_TIMEOUT_TITLE}. Verifique se ele está online e tente novamente.`;
  const detail = text.split('HubException:')[1]?.trim();
  return detail ? `Não foi possível abrir o terminal: ${detail}` : 'Não foi possível abrir o terminal. Tente novamente.';
}

function silence(promise: Promise<unknown>): void {
  promise.catch(() => undefined);
}

interface PendingChunk {
  sessionId: string;
  data: string;
}

export function TerminalTab({ agent }: { agent: AgentDetail }) {
  const { connection, connected } = useConsoleHubConnection();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<string | null>(null);
  const startingRef = useRef(false);
  const pendingRef = useRef<PendingChunk[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [sessionConnectionId, setSessionConnectionId] = useState<string | null>(null);
  const [shell, setShell] = useState<string>(DEFAULT_SHELL);

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

  const start = async () => {
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
      const sessionId = await connection.invoke<string>('StartTerminal', agent.id, term.cols, term.rows, shell === DEFAULT_SHELL ? null : shell);
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
  const effective: Status = lost ? 'closed' : status;
  const shownMessage = lost ? 'A conexão com o servidor caiu e a sessão foi encerrada.' : message;

  return (
    <Stack>
      <Group justify="space-between" wrap="wrap">
        <Group gap="sm">
          <Select
            aria-label="Shell do terminal"
            data={shellOptions(agent.plat)}
            value={shell}
            onChange={(value) => setShell(value ?? DEFAULT_SHELL)}
            allowDeselect={false}
            disabled={effective === 'open' || effective === 'starting'}
            w={200}
          />
          {effective === 'open' ? (
            <Button color="red" variant="light" leftSection={<IconPlayerStop size={16} />} onClick={stop}>
              Encerrar
            </Button>
          ) : (
            <Button
              leftSection={effective === 'closed' ? <IconRefresh size={16} /> : <IconPlayerPlay size={16} />}
              loading={effective === 'starting'}
              disabled={!connected}
              onClick={() => void start()}
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
        <Box ref={containerRef} h={480} aria-label={`Terminal de ${agent.hostname}`} role="region" />
      </Paper>
    </Stack>
  );
}
