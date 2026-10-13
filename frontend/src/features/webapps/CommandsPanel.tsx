import { useState } from 'react';
import { ActionIcon, Badge, Button, Grid, Group, Kbd, Paper, Stack, Text, Textarea, Tooltip } from '@mantine/core';
import { IconPencil, IconPlayerPlay, IconPlus, IconTerminal2, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import type { AppCommandDto } from '../../api/types';
import { appCommandsApi, appServersApi } from '../../api/webapps';
import { LoadError } from '../../components/TableStates';
import { confirmAction, notifySuccess } from '../../lib/feedback';
import { CommandFormModal } from './CommandFormModal';
import { RunOutput } from './RunOutput';

interface CommandsPanelProps {
  serverId: number;
  /** Contexto da aplicacao: lista os comandos dela e os do servidor; o avulso roda na pasta dela. */
  webAppId?: number;
  directory?: string | null;
  canRun: boolean;
  canManage: boolean;
}

type Editing = { command: AppCommandDto | null } | null;

/** Comandos salvos (snippets) e comando avulso, com a saida da ultima execucao ao lado. */
export function CommandsPanel({ serverId, webAppId, directory, canRun, canManage }: CommandsPanelProps) {
  const queryClient = useQueryClient();
  const [script, setScript] = useState('');
  const [runId, setRunId] = useState<number | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const params = webAppId ? { webAppId } : { serverId };
  const commands = useQuery({ queryKey: queryKeys.appCommandList(webAppId ? undefined : serverId, webAppId), queryFn: () => appCommandsApi.list(params) });

  const run = useMutation({
    mutationFn: (body: { script?: string; commandId?: number }) =>
      appServersApi.run(serverId, body.commandId ? { commandId: body.commandId } : { script: body.script, webAppId }),
    onSuccess: (started) => {
      setRunId(started.id);
      void queryClient.invalidateQueries({ queryKey: queryKeys.appRunLists });
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => appCommandsApi.remove(id),
    onSuccess: () => {
      notifySuccess('Comando excluído.');
      void queryClient.invalidateQueries({ queryKey: queryKeys.appCommands });
    },
  });

  const runSaved = (command: AppCommandDto) => {
    if (!command.confirm) {
      run.mutate({ commandId: command.id });
      return;
    }
    confirmAction({
      title: `Rodar "${command.name}"?`,
      message: command.script.length > 300 ? `${command.script.slice(0, 300)}...` : command.script,
      confirmLabel: 'Rodar',
      danger: true,
      onConfirm: () => run.mutate({ commandId: command.id }),
    });
  };

  const runAdHoc = () => {
    if (script.trim() && canRun) run.mutate({ script });
  };

  return (
    <Grid gap="lg">
      <Grid.Col span={{ base: 12, md: 5 }}>
        <Stack gap="sm">
          <Group justify="space-between">
            <Text fw={600} size="sm">
              Comandos salvos
            </Text>
            {canManage && (
              <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setEditing({ command: null })}>
                Novo comando
              </Button>
            )}
          </Group>
          {commands.isError && <LoadError error={commands.error} onRetry={() => void commands.refetch()} />}
          {commands.data?.length === 0 && (
            <Text size="sm" c="dimmed">
              Nenhum comando salvo. Guarde aqui os comandos que você roda sempre: reiniciar, ver logs, limpar cache.
            </Text>
          )}
          {commands.data?.map((command) => (
            <Paper key={command.id} withBorder p="sm">
              <Group justify="space-between" wrap="nowrap" align="flex-start">
                <Stack gap={2} style={{ minWidth: 0 }}>
                  <Group gap={6}>
                    <Text size="sm" fw={600}>
                      {command.name}
                    </Text>
                    {webAppId && command.webAppId === null && (
                      <Badge size="xs" variant="light" color="gray">
                        do servidor
                      </Badge>
                    )}
                    {command.confirm && (
                      <Badge size="xs" variant="light" color="orange">
                        confirma
                      </Badge>
                    )}
                  </Group>
                  {command.description && (
                    <Text size="xs" c="dimmed">
                      {command.description}
                    </Text>
                  )}
                  <Text size="xs" ff="monospace" c="dimmed" lineClamp={2} style={{ whiteSpace: 'pre-wrap' }}>
                    {command.script}
                  </Text>
                </Stack>
                <Group gap={4} wrap="nowrap">
                  {canRun && (
                    <Tooltip label="Executar">
                      <ActionIcon variant="light" aria-label={`Executar ${command.name}`} loading={run.isPending} onClick={() => runSaved(command)}>
                        <IconPlayerPlay size={16} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                  {canManage && (
                    <>
                      <Tooltip label="Editar">
                        <ActionIcon variant="subtle" color="gray" aria-label={`Editar ${command.name}`} onClick={() => setEditing({ command })}>
                          <IconPencil size={16} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Excluir">
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          aria-label={`Excluir ${command.name}`}
                          onClick={() =>
                            confirmAction({
                              title: 'Excluir comando',
                              message: `Excluir o comando salvo ${command.name}? O histórico das execuções continua.`,
                              confirmLabel: 'Excluir',
                              danger: true,
                              onConfirm: () => remove.mutate(command.id),
                            })
                          }
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Tooltip>
                    </>
                  )}
                </Group>
              </Group>
            </Paper>
          ))}
        </Stack>
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 7 }}>
        <Stack gap="sm">
          {canRun && (
            <>
              <Textarea
                label="Comando avulso"
                description={
                  <>
                    Roda em bash {directory ? `na pasta ${directory}` : 'na pasta do usuário SSH'}, sem terminal interativo. <Kbd size="xs">Ctrl</Kbd> +{' '}
                    <Kbd size="xs">Enter</Kbd> executa.
                  </>
                }
                placeholder="docker compose ps"
                autosize
                minRows={2}
                maxRows={10}
                spellCheck={false}
                styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)', fontSize: 13 } }}
                value={script}
                onChange={(e) => setScript(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    runAdHoc();
                  }
                }}
              />
              <Group justify="flex-end">
                <Button leftSection={<IconTerminal2 size={16} />} loading={run.isPending} disabled={!script.trim()} onClick={runAdHoc}>
                  Executar
                </Button>
              </Group>
            </>
          )}
          {runId !== null ? (
            <RunOutput runId={runId} canCancel={canRun} />
          ) : (
            <Text size="sm" c="dimmed">
              A saída do comando aparece aqui em tempo real e fica no histórico.
            </Text>
          )}
        </Stack>
      </Grid.Col>
      {canManage && editing && (
        <CommandFormModal
          opened
          onClose={() => setEditing(null)}
          command={editing.command}
          owner={webAppId ? { webAppId } : { serverId }}
        />
      )}
    </Grid>
  );
}
