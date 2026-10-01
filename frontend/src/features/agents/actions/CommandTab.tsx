import { useState } from 'react';
import { Button, Group, NumberInput, Paper, SegmentedControl, Stack, Switch, Text, Textarea } from '@mantine/core';
import { IconPlayerPlay } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { agentActionsApi } from '../../../api/agentActions';
import { queryKeys } from '../../../api/queryKeys';
import type { AgentDetail, CommandRequest, CommandShell } from '../../../api/types';
import { ApiErrorAlert } from '../../../components/ApiErrorAlert';
import { OutputBlock } from '../../../components/OutputBlock';
import { confirmAction } from '../../../lib/feedback';
import { defaultShell, isWindows, shellsFor } from './shells';

const MIN_TIMEOUT = 10;
const MAX_TIMEOUT = 3600;

export function CommandTab({ agent }: { agent: AgentDetail }) {
  const queryClient = useQueryClient();
  const windows = isWindows(agent.plat);
  const [shell, setShell] = useState<CommandShell>(defaultShell(agent.plat));
  const [command, setCommand] = useState('');
  const [timeout, setTimeoutValue] = useState<number>(30);
  const [runAsUser, setRunAsUser] = useState(false);

  const run = useMutation({
    mutationFn: (body: CommandRequest) => agentActionsApi.command(agent.id, body, { silent: true }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: queryKeys.agentHistory(agent.id) }),
  });

  const timeoutValid = Number.isInteger(timeout) && timeout >= MIN_TIMEOUT && timeout <= MAX_TIMEOUT;
  const canRun = command.trim() !== '' && timeoutValid && !run.isPending;

  const submit = () => {
    if (!canRun) return;
    const body: CommandRequest = { shell, command, timeout, runAsUser: windows && runAsUser };
    confirmAction({
      title: 'Executar comando',
      message: `O comando será executado em ${agent.hostname} com ${shell}. Deseja continuar?`,
      confirmLabel: 'Executar',
      onConfirm: () => run.mutate(body),
    });
  };

  return (
    <Stack>
      <Paper withBorder p="md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          noValidate
        >
          <Stack>
            <div>
              <Text size="sm" fw={500} mb={4} id="command-shell-label">
                Shell
              </Text>
              <SegmentedControl
                aria-labelledby="command-shell-label"
                value={shell}
                onChange={setShell}
                data={shellsFor(agent.plat).map((s) => ({ value: s.value, label: s.label }))}
              />
            </div>
            <Textarea
              label="Comando"
              placeholder={windows ? 'Ex.: ipconfig /all' : 'Ex.: df -h'}
              autosize
              minRows={3}
              maxRows={12}
              required
              styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
              value={command}
              onChange={(e) => setCommand(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            <Group align="flex-end" gap="lg">
              <NumberInput
                label="Tempo limite (segundos)"
                min={MIN_TIMEOUT}
                max={MAX_TIMEOUT}
                allowDecimal={false}
                w={200}
                value={timeout}
                onChange={(value) => setTimeoutValue(typeof value === 'number' ? value : Number.parseInt(value, 10))}
                error={timeoutValid ? undefined : `Entre ${MIN_TIMEOUT} e ${MAX_TIMEOUT} segundos`}
              />
              {windows && (
                <Switch
                  label="Executar como o usuário logado"
                  checked={runAsUser}
                  onChange={(e) => setRunAsUser(e.currentTarget.checked)}
                  mb={8}
                />
              )}
            </Group>
            <Group justify="space-between">
              <Text size="xs" c="dimmed">
                Ctrl+Enter executa. A execução fica registrada no histórico e na auditoria.
              </Text>
              <Button type="submit" leftSection={<IconPlayerPlay size={16} />} loading={run.isPending} disabled={!canRun}>
                Executar
              </Button>
            </Group>
          </Stack>
        </form>
      </Paper>
      {run.isError && <ApiErrorAlert error={run.error} />}
      {run.isSuccess && (
        <Paper withBorder p="md">
          <OutputBlock label="Saída" value={run.data.output} />
        </Paper>
      )}
    </Stack>
  );
}
