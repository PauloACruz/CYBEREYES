import { useMemo, useState } from 'react';
import { Badge, Button, Group, NumberInput, Paper, Select, SimpleGrid, Stack, Switch, Text } from '@mantine/core';
import { IconPlayerPlay } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { agentActionsApi } from '../../../api/agentActions';
import { queryKeys } from '../../../api/queryKeys';
import { scriptsApi } from '../../../api/scripts';
import type { AgentDetail, RunScriptRequest, ScriptDto } from '../../../api/types';
import { ApiErrorAlert } from '../../../components/ApiErrorAlert';
import { OutputBlock } from '../../../components/OutputBlock';
import { StringListInput } from '../../../components/StringListInput';
import { LoadError } from '../../../components/TableStates';
import { confirmAction } from '../../../lib/feedback';
import { formatSeconds } from '../../../lib/format';
import { shellLabel, supportsPlatform } from '../../scripts/scriptMeta';
import { TemplateVariablesHint } from '../../scripts/TemplateVariablesHint';
import { isWindows } from './shells';

const MIN_TIMEOUT = 5;
const MAX_TIMEOUT = 86400;

interface RunOptions {
  args: string[];
  envVars: string[];
  timeout: number;
  runAsUser: boolean;
}

function defaultsOf(script: ScriptDto): RunOptions {
  return {
    args: [...script.defaultArgs],
    envVars: [...script.envVars],
    timeout: script.defaultTimeout,
    runAsUser: script.runAsUser,
  };
}

export function ScriptRunTab({ agent }: { agent: AgentDetail }) {
  const queryClient = useQueryClient();
  const windows = isWindows(agent.plat);
  const scripts = useQuery({ queryKey: queryKeys.scripts, queryFn: scriptsApi.list });
  const compatible = useMemo(
    () => (scripts.data ?? []).filter((s) => supportsPlatform(s, agent.plat)),
    [scripts.data, agent.plat],
  );
  const [scriptId, setScriptId] = useState<string | null>(null);
  const [options, setOptions] = useState<RunOptions | null>(null);
  const selected = compatible.find((s) => String(s.id) === scriptId) ?? null;

  const run = useMutation({
    mutationFn: (body: RunScriptRequest) => agentActionsApi.runScript(agent.id, body, { silent: true }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: queryKeys.agentHistory(agent.id) }),
  });

  const selectScript = (value: string | null) => {
    setScriptId(value);
    const script = compatible.find((s) => String(s.id) === value);
    setOptions(script ? defaultsOf(script) : null);
    run.reset();
  };

  const timeoutValid = options !== null && Number.isInteger(options.timeout) && options.timeout >= MIN_TIMEOUT && options.timeout <= MAX_TIMEOUT;

  const submit = () => {
    if (!selected || !options || !timeoutValid) return;
    const body: RunScriptRequest = {
      scriptId: selected.id,
      args: options.args.filter((a) => a.trim() !== ''),
      envVars: options.envVars.filter((v) => v.trim() !== ''),
      timeout: options.timeout,
      runAsUser: windows && options.runAsUser,
    };
    confirmAction({
      title: 'Executar script',
      message: `O script "${selected.name}" será executado em ${agent.hostname}. Deseja continuar?`,
      confirmLabel: 'Executar',
      onConfirm: () => run.mutate(body),
    });
  };

  if (scripts.isError) return <LoadError error={scripts.error} onRetry={() => void scripts.refetch()} />;

  return (
    <Stack>
      <Paper withBorder p="md">
        <Stack>
          <Select
            label="Script"
            placeholder={scripts.isPending ? 'Carregando scripts...' : 'Escolha um script compatível com este sistema'}
            searchable
            nothingFoundMessage="Nenhum script compatível"
            data={compatible.map((s) => ({ value: String(s.id), label: s.category ? `${s.category} / ${s.name}` : s.name }))}
            value={scriptId}
            onChange={selectScript}
            disabled={scripts.isPending}
          />
          {scripts.isSuccess && compatible.length === 0 && (
            <Text size="sm" c="dimmed">
              Nenhum script da biblioteca é compatível com este sistema.
            </Text>
          )}
          {selected && options && (
            <>
              <Group gap="xs">
                <Badge variant="light">{shellLabel(selected.shell)}</Badge>
                {selected.description && (
                  <Text size="sm" c="dimmed">
                    {selected.description}
                  </Text>
                )}
              </Group>
              <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
                <StringListInput
                  label="Argumentos"
                  addLabel="Adicionar argumento"
                  placeholder="-Parametro valor"
                  value={options.args}
                  onChange={(args) => setOptions({ ...options, args })}
                />
                <StringListInput
                  label="Variáveis de ambiente"
                  description="No formato NOME=valor"
                  addLabel="Adicionar variável"
                  placeholder="NOME=valor"
                  value={options.envVars}
                  onChange={(envVars) => setOptions({ ...options, envVars })}
                />
              </SimpleGrid>
              <Group align="flex-end" gap="lg">
                <NumberInput
                  label="Tempo limite (segundos)"
                  min={MIN_TIMEOUT}
                  max={MAX_TIMEOUT}
                  allowDecimal={false}
                  w={200}
                  value={options.timeout}
                  onChange={(value) => setOptions({ ...options, timeout: typeof value === 'number' ? value : Number.parseInt(value, 10) })}
                  error={timeoutValid ? undefined : `Entre ${MIN_TIMEOUT} e ${MAX_TIMEOUT} segundos`}
                />
                {windows && (
                  <Switch
                    label="Executar como o usuário logado"
                    checked={options.runAsUser}
                    onChange={(e) => setOptions({ ...options, runAsUser: e.currentTarget.checked })}
                    mb={8}
                  />
                )}
              </Group>
              <TemplateVariablesHint context="nos argumentos e nas variáveis de ambiente" />
              <Group justify="flex-end">
                <Button leftSection={<IconPlayerPlay size={16} />} onClick={submit} loading={run.isPending} disabled={!timeoutValid}>
                  Executar script
                </Button>
              </Group>
            </>
          )}
        </Stack>
      </Paper>
      {run.isError && <ApiErrorAlert error={run.error} />}
      {run.isSuccess && (
        <Paper withBorder p="md">
          <Stack>
            <Group gap="lg">
              <Text size="sm">
                Código de retorno:{' '}
                <Badge color={run.data.retcode === 0 ? 'teal' : 'red'} variant="light">
                  {run.data.retcode}
                </Badge>
              </Text>
              <Text size="sm">Tempo de execução: {formatSeconds(run.data.executionTime)}</Text>
            </Group>
            <OutputBlock label="Saída padrão (stdout)" value={run.data.stdout} />
            {run.data.stderr && <OutputBlock label="Saída de erro (stderr)" value={run.data.stderr} color="red" />}
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}
