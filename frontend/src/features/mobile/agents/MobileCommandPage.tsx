import { useState } from 'react';
import { Badge, Box, Button, Center, Group, Loader, NumberInput, SegmentedControl, Stack, Switch, Text, Textarea, UnstyledButton } from '@mantine/core';
import { IconPlayerPlay } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { agentActionsApi } from '../../../api/agentActions';
import { agentsApi } from '../../../api/agents';
import { queryKeys } from '../../../api/queryKeys';
import type { AgentDetail, CommandRequest, CommandShell } from '../../../api/types';
import { MOBILE_PATHS, mobileAgentPath } from '../../../app/paths';
import { ApiErrorAlert } from '../../../components/ApiErrorAlert';
import { OutputBlock } from '../../../components/OutputBlock';
import { LoadError } from '../../../components/TableStates';
import { confirmAction } from '../../../lib/feedback';
import { AgentStatusBadge } from '../../agents/agentDisplay';
import { defaultShell, isWindows, shellsFor } from '../../agents/actions/shells';
import { MobileHeader, MobilePage, MobileSection } from '../MobilePage';
import { quickCommandsFor } from './quickCommands';

const MIN_TIMEOUT = 10;
const MAX_TIMEOUT = 3600;

export function MobileCommandPage() {
  const { id: rawId } = useParams();
  const id = Number(rawId);
  const valid = Number.isInteger(id) && id > 0;
  const agent = useQuery({ queryKey: queryKeys.agentDetail(id), queryFn: () => agentsApi.get(id), enabled: valid });
  const header = <MobileHeader title="Enviar comando" back={{ to: valid ? mobileAgentPath(id) : MOBILE_PATHS.agents, label: agent.data?.hostname ?? 'Agente' }} />;

  return (
    <MobilePage header={header} bottom={null}>
      {agent.isError && <LoadError error={agent.error} onRetry={() => void agent.refetch()} />}
      {!agent.data && !agent.isError && (
        <Center py="xl">
          <Loader aria-label="Carregando agente" />
        </Center>
      )}
      {agent.data && <CommandForm key={agent.data.id} agent={agent.data} />}
    </MobilePage>
  );
}

/** Comando no agente pelo celular: shell, comandos rapidos, tempo limite e a saida. */
function CommandForm({ agent }: { agent: AgentDetail }) {
  const queryClient = useQueryClient();
  const windows = isWindows(agent.plat);
  const [shell, setShell] = useState<CommandShell>(windows ? 'powershell' : defaultShell(agent.plat));
  const [command, setCommand] = useState('');
  const [timeout, setTimeoutValue] = useState<number>(30);
  const [runAsUser, setRunAsUser] = useState(false);
  const run = useMutation({
    mutationFn: (body: CommandRequest) => agentActionsApi.command(agent.id, body, { silent: true }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: queryKeys.agentHistory(agent.id) }),
  });
  const timeoutValid = Number.isInteger(timeout) && timeout >= MIN_TIMEOUT && timeout <= MAX_TIMEOUT;
  const canRun = command.trim() !== '' && timeoutValid && !run.isPending && agent.status !== 'offline';

  const submit = () => {
    if (!canRun) return;
    const body: CommandRequest = { shell, command, timeout, runAsUser: windows && runAsUser };
    const label = shellsFor(agent.plat).find((s) => s.value === shell)?.label ?? shell;
    confirmAction({
      title: 'Executar comando',
      message: `O comando será executado em ${agent.hostname} com ${label}. Deseja continuar?`,
      confirmLabel: 'Executar',
      onConfirm: () => run.mutate(body),
    });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      noValidate
    >
      <Stack gap="md">
        <Group gap={8}>
          <Text ff="monospace" fw={500}>
            {agent.hostname}
          </Text>
          <AgentStatusBadge status={agent.status} />
          <Text size="sm" c="var(--ce-text-secondary)">
            {agent.operatingSystem}
          </Text>
        </Group>
        {agent.status === 'offline' && (
          <Text size="sm" c="red">
            Agente offline: o comando fica disponível quando ele se conectar.
          </Text>
        )}
        <Stack gap={6}>
          <Text size="sm" fw={600} id="shell-movel">
            Shell
          </Text>
          <SegmentedControl
            aria-labelledby="shell-movel"
            fullWidth
            size="md"
            value={shell}
            onChange={setShell}
            data={shellsFor(agent.plat).map((s) => ({ value: s.value, label: s.label }))}
          />
        </Stack>
        <MobileSection title="Comandos rápidos">
          <Group gap={8} wrap="nowrap" mx={-16} px={16} pb={2} style={{ overflowX: 'auto', scrollbarWidth: 'none' }}>
            {quickCommandsFor(shell).map((q) => (
              <UnstyledButton
                key={q.label}
                onClick={() => setCommand(q.command)}
                h={36}
                px={14}
                style={{
                  borderRadius: 18,
                  border: '1px solid var(--ce-border-strong)',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                {q.label}
              </UnstyledButton>
            ))}
          </Group>
        </MobileSection>
        <Textarea
          label="Comando"
          placeholder={shell === 'powershell' ? 'Get-Service Spooler' : windows ? 'ipconfig /all' : 'df -h'}
          autosize
          minRows={3}
          maxRows={10}
          size="md"
          required
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)', fontSize: 14 } }}
          value={command}
          onChange={(e) => setCommand(e.currentTarget.value)}
        />
        {windows && (
          <Switch label="Executar como o usuário logado" size="md" checked={runAsUser} onChange={(e) => setRunAsUser(e.currentTarget.checked)} />
        )}
        <NumberInput
          label="Tempo limite (segundos)"
          min={MIN_TIMEOUT}
          max={MAX_TIMEOUT}
          allowDecimal={false}
          inputMode="numeric"
          size="md"
          w={180}
          value={timeout}
          onChange={(value) => setTimeoutValue(typeof value === 'number' ? value : Number.parseInt(value, 10))}
          error={timeoutValid ? undefined : `Entre ${MIN_TIMEOUT} e ${MAX_TIMEOUT} segundos`}
        />
        <Button type="submit" size="md" fullWidth leftSection={<IconPlayerPlay size={18} />} loading={run.isPending} disabled={!canRun}>
          Executar
        </Button>
        {run.isError && <ApiErrorAlert error={run.error} />}
        {run.isSuccess && (
          <Box>
            <Group gap={8} mb={8}>
              <Badge color="teal" variant="light">
                Concluído
              </Badge>
              <Text size="sm" c="var(--ce-text-secondary)">
                Fica registrado no histórico e na auditoria.
              </Text>
            </Group>
            <OutputBlock label="Saída" value={run.data.output} maxHeight={480} />
          </Box>
        )}
      </Stack>
    </form>
  );
}
