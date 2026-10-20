import { useState } from 'react';
import {
  ActionIcon,
  Alert,
  Anchor,
  Button,
  Checkbox,
  Divider,
  Group,
  NumberInput,
  Paper,
  PasswordInput,
  SegmentedControl,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { IconDeviceFloppy, IconPlayerPlay, IconPlugConnected, IconPlus, IconRefresh, IconShieldLock } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { assistantApi } from '../../api/assistant';
import { queryKeys } from '../../api/queryKeys';
import { MODEL_FROM_AGENT, type AssistantSettingsDto, type EffortLevel, type InsightLevel } from '../../api/types';
import { LoadError } from '../../components/TableStates';
import { AgentPermissions } from './AgentPermissions';
import { notifySuccess } from '../../lib/feedback';
import { formatDateTime } from '../../lib/format';

const MODEL_LABELS: Record<string, string> = {
  'claude-opus-5-5': 'Claude Opus 5.5 (recomendado)',
  'claude-sonnet-5-5': 'Claude Sonnet 5.5 (mais rápido)',
  'claude-haiku-5-5': 'Claude Haiku 5.5 (mais econômico)',
};

const EFFORT_OPTIONS: { value: EffortLevel; label: string }[] = [
  { value: 'low', label: 'Baixo: mais rápido e barato' },
  { value: 'medium', label: 'Médio' },
  { value: 'high', label: 'Alto' },
  { value: 'xhigh', label: 'Muito alto' },
  { value: 'max', label: 'Máximo: mais lento e caro' },
];

function isEffort(value: string | null): value is EffortLevel {
  return EFFORT_OPTIONS.some((o) => o.value === value);
}

const LEVEL_OPTIONS: { value: InsightLevel; label: string }[] = [
  { value: 'warning', label: 'Aviso ou mais grave' },
  { value: 'error', label: 'Erro ou mais grave' },
  { value: 'critical', label: 'Somente crítico' },
];

function isInsightLevel(value: string | null): value is InsightLevel {
  return LEVEL_OPTIONS.some((o) => o.value === value);
}

function validAnthropicKey(key: string): boolean {
  return key.startsWith('sk-ant-') && key.length >= 20 && !/\s/.test(key);
}

const MAX_INSTRUCTIONS = 20000;

const INSTRUCTIONS_PLACEHOLDER = `Ex.: Somos a ACME TI. Atendemos de segunda a sexta, das 8h às 18h.
Trate o usuário por você e assine como Suporte ACME.
Problemas de impressora da filial Centro vão para a fila Campo.`;

function AssistantForm({ initial }: { initial: AssistantSettingsDto }) {
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState('');
  const [removeKey, setRemoveKey] = useState(false);
  const [model, setModel] = useState(initial.model);
  const [agentId, setAgentId] = useState<string | null>(initial.agentId);
  const [agentEnabled, setAgentEnabled] = useState(initial.agentEnabled);
  const [nativeEnabled, setNativeEnabled] = useState(initial.nativeEnabled);
  const [instructions, setInstructions] = useState(initial.instructions ?? '');
  const [nativePermissions, setNativePermissions] = useState(initial.nativePermissions);
  const [agentPermissions, setAgentPermissions] = useState(initial.agentPermissions);
  const [permissionsOf, setPermissionsOf] = useState<'native' | 'anthropic'>('native');
  const [chatEffort, setChatEffort] = useState<EffortLevel>(initial.chatEffort);
  const [logEffort, setLogEffort] = useState<EffortLevel>(initial.logEffort);
  const [name, setName] = useState(initial.name);
  const [chatEnabled, setChatEnabled] = useState(initial.chatEnabled);
  const [faqLearn, setFaqLearn] = useState(initial.faqLearn);
  const [insightsEnabled, setInsightsEnabled] = useState(initial.logInsightsEnabled);
  const [interval, setInterval] = useState<number | string>(initial.logInsightsIntervalHours);
  const [minLevel, setMinLevel] = useState<InsightLevel>(initial.logInsightsMinLevel);
  const [push, setPush] = useState(initial.logInsightsPush);
  const [email, setEmail] = useState(initial.logInsightsEmail);

  const typedKey = apiKey.trim();
  const keyError = typedKey && !validAnthropicKey(typedKey) ? 'A chave da Anthropic começa com sk-ant-' : undefined;
  const willHaveKey = removeKey ? typedKey.length > 0 : initial.keySet || typedKey.length > 0;
  const hours = Number(interval);
  const intervalError = Number.isInteger(hours) && hours >= 1 && hours <= 168 ? undefined : 'Entre 1 e 168 horas';
  const nameError = name.trim().length >= 2 ? undefined : 'Use pelo menos 2 caracteres';
  const needsKey = (chatEnabled || insightsEnabled) && !willHaveKey;
  const linkedActive = agentEnabled && agentId !== null;
  const needsAgent = (chatEnabled || insightsEnabled) && !nativeEnabled && !linkedActive;
  const instructionsError = instructions.length > MAX_INSTRUCTIONS ? `Use no máximo ${MAX_INSTRUCTIONS} caracteres` : undefined;

  const agents = useQuery({ queryKey: queryKeys.assistantAgents, queryFn: assistantApi.agents, enabled: initial.keySet, retry: false });
  const linked = agents.data?.find((a) => a.id === agentId);
  const missingAgent = Boolean(agentId && agents.data && !linked);

  const chooseAgent = (next: string | null) => {
    setAgentId(next);
    if (!next && model === MODEL_FROM_AGENT) setModel(initial.models[0] ?? 'claude-opus-5-5');
  };

  // Desligado, o agente da Anthropic nao empresta o modelo: volta para um fixo.
  const toggleAgent = (on: boolean) => {
    setAgentEnabled(on);
    if (!on && model === MODEL_FROM_AGENT) setModel(initial.models[0] ?? 'claude-opus-5-5');
  };

  const createAgent = useMutation({
    mutationFn: () => assistantApi.createAgent(name.trim() || initial.name, model === MODEL_FROM_AGENT ? null : model),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.assistantAgents });
      setAgentId(created.id);
      notifySuccess(`Agente ${created.name} criado na Anthropic. Ajuste as instruções dele no Console e salve aqui para vincular.`);
    },
  });

  const save = useMutation({
    mutationFn: () =>
      assistantApi.saveSettings({
        apiKey: typedKey ? typedKey : removeKey ? '' : null,
        model,
        agentId,
        agentEnabled,
        nativeEnabled,
        instructions: instructions.trim() || null,
        nativePermissions,
        agentPermissions,
        chatEffort,
        logEffort,
        name: name.trim(),
        chatEnabled,
        faqLearn,
        logInsightsEnabled: insightsEnabled,
        logInsightsIntervalHours: hours,
        logInsightsMinLevel: minLevel,
        logInsightsPush: push,
        logInsightsEmail: email,
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.assistantSettings, saved);
      setApiKey('');
      setRemoveKey(false);
      notifySuccess('Configuração do assistente salva.');
    },
  });

  const test = useMutation({
    mutationFn: () => assistantApi.test(typedKey || null, model, agentId),
    onSuccess: (result) => notifySuccess(result.message, 'Conexão com a Anthropic'),
  });

  const run = useMutation({
    mutationFn: assistantApi.runInsights,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.logInsights });
      notifySuccess('Análise iniciada. O resultado aparece em Logs, na aba Análises da IA.');
    },
  });

  const keyPlaceholder = initial.keySet ? `Chave gravada terminando em ${initial.keyHint ?? '****'}` : 'sk-ant-...';
  const models = [
    ...(linkedActive ? [{ value: MODEL_FROM_AGENT, label: `Modelo do agente${linked ? ` (${linked.model})` : ''}` }] : []),
    ...initial.models.map((m) => ({ value: m, label: MODEL_LABELS[m] ?? m })),
  ];
  const agentOptions = [
    ...(agents.data ?? []).map((a) => ({ value: a.id, label: `${a.name} · ${a.model} · v${a.version}` })),
    ...(missingAgent && agentId ? [{ value: agentId, label: `${agentId} (não encontrado na conta)` }] : []),
  ];
  const agentError = agents.error
    ? agents.error.message
    : missingAgent
      ? 'O agente vinculado não existe mais na conta; o assistente usa as instruções padrão.'
      : undefined;

  return (
    <Paper withBorder p="lg">
      <Stack gap="md">
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <PasswordInput
            label="Chave da API da Anthropic"
            description={
              <>
                Crie em{' '}
                <Anchor href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" size="xs">
                  console.anthropic.com
                </Anchor>
                . Fica cifrada no servidor e não é exibida de novo.
              </>
            }
            placeholder={keyPlaceholder}
            value={apiKey}
            onChange={(e) => setApiKey(e.currentTarget.value)}
            error={keyError}
            autoComplete="off"
          />
        </SimpleGrid>
        <Group gap="md">
          <Button
            variant="default"
            leftSection={<IconPlugConnected size={16} />}
            loading={test.isPending}
            disabled={Boolean(keyError) || (!typedKey && !initial.keySet)}
            onClick={() => test.mutate()}
          >
            Testar conexão
          </Button>
          {initial.keySet && (
            <Checkbox label="Remover a chave gravada" checked={removeKey} onChange={(e) => setRemoveKey(e.currentTarget.checked)} />
          )}
        </Group>
        <Divider label="Agentes" labelPosition="left" />
        <Text size="sm" c="dimmed">
          As regras de funcionamento do Cybereyes (formato das respostas, ações e FAQ) valem sempre. Os agentes acrescentam o tom e as regras da
          sua empresa; com os dois ligados, entram as instruções dos dois e, se conflitarem, valem as do agente nativo.
        </Text>
        <SimpleGrid cols={{ base: 1, md: 2 }}>
          <Paper withBorder p="md">
            <Stack gap="sm">
              <Switch
                label="Agente nativo do Cybereyes"
                description="Usa as instruções escritas aqui, sem depender de um agente na conta da Anthropic."
                checked={nativeEnabled}
                onChange={(e) => setNativeEnabled(e.currentTarget.checked)}
              />
              <Textarea
                label="Instruções do agente nativo"
                description={
                  nativeEnabled
                    ? 'Tom, horário de atendimento, regras e particularidades da empresa. Valem no chat e na análise de logs.'
                    : 'Agente nativo desligado: as instruções ficam guardadas, sem uso.'
                }
                placeholder={INSTRUCTIONS_PLACEHOLDER}
                autosize
                minRows={5}
                maxRows={14}
                value={instructions}
                onChange={(e) => setInstructions(e.currentTarget.value)}
                error={instructionsError}
                disabled={!nativeEnabled}
              />
            </Stack>
          </Paper>
          <Paper withBorder p="md">
            <Stack gap={6}>
              <Switch
                label="Agente da Anthropic (integração)"
                description="Agente da sua conta na Anthropic (Console, Managed Agents): as instruções dele entram no atendimento e o modelo dele pode ser usado."
                checked={agentEnabled}
                onChange={(e) => toggleAgent(e.currentTarget.checked)}
                mb="xs"
              />
              <Group gap="xs" align="flex-end" wrap="nowrap">
                <Select
                  label="Agente vinculado"
                  description={agentEnabled ? undefined : 'Desligado: o agente fica vinculado, sem uso.'}
                  placeholder={initial.keySet ? 'Nenhum agente vinculado' : 'Salve a chave para listar os agentes'}
                  data={agentOptions}
                  value={agentId}
                  onChange={chooseAgent}
                  clearable
                  clearButtonProps={{ 'aria-label': 'Desvincular o agente' }}
                  searchable
                  disabled={!initial.keySet || !agentEnabled}
                  error={agentError}
                  nothingFoundMessage={agents.isFetching ? 'Carregando...' : 'Nenhum agente na conta'}
                  style={{ flex: 1 }}
                />
                <Tooltip label="Atualizar a lista de agentes">
                  <ActionIcon
                    variant="default"
                    size="lg"
                    mb={agentError ? 22 : 0}
                    aria-label="Atualizar a lista de agentes"
                    disabled={!initial.keySet || !agentEnabled}
                    loading={agents.isFetching}
                    onClick={() => void agents.refetch()}
                  >
                    <IconRefresh size={16} />
                  </ActionIcon>
                </Tooltip>
              </Group>
              <Group gap="xs">
                <Button
                  variant="subtle"
                  size="xs"
                  leftSection={<IconPlus size={14} />}
                  disabled={!initial.keySet || !agentEnabled}
                  loading={createAgent.isPending}
                  onClick={() => createAgent.mutate()}
                >
                  Criar agente na Anthropic
                </Button>
                {linked?.description && (
                  <Text size="xs" c="dimmed" lineClamp={2}>
                    {linked.description}
                  </Text>
                )}
              </Group>
            </Stack>
          </Paper>
        </SimpleGrid>
        {needsAgent && (
          <Text size="sm" c="red">
            Ative o agente nativo ou o agente da Anthropic (com um agente vinculado) para ligar o assistente.
          </Text>
        )}

        <Divider label="Permissões dos agentes" labelPosition="left" />
        <Text size="sm" c="dimmed">
          O que cada agente pode fazer quando um técnico pede ações no menu Agente de IA. Vale o que o agente e o técnico têm ao mesmo tempo, e
          ações que mudam máquinas ainda esperam a aprovação do técnico. Na auditoria, o técnico aparece como autor e o agente como executor.
        </Text>
        <SegmentedControl
          aria-label="Permissões de qual agente"
          value={permissionsOf}
          onChange={(v) => setPermissionsOf(v === 'anthropic' ? 'anthropic' : 'native')}
          data={[
            { value: 'native', label: 'Agente nativo' },
            { value: 'anthropic', label: 'Agente da Anthropic' },
          ]}
          w="fit-content"
        />
        {permissionsOf === 'native' ? (
          <AgentPermissions agent="agente nativo" catalog={initial.permissionCatalog} value={nativePermissions} onChange={setNativePermissions} />
        ) : (
          <AgentPermissions
            agent="agente da Anthropic"
            catalog={initial.permissionCatalog}
            value={agentPermissions}
            onChange={setAgentPermissions}
          />
        )}
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Select
            label="Modelo"
            description="O Opus dá as análises mais completas; Sonnet e Haiku respondem mais rápido e custam menos."
            data={models}
            value={model}
            onChange={(v) => v && setModel(v)}
            allowDeselect={false}
          />
          <TextInput
            label="Nome do assistente"
            description="Como ele se apresenta aos usuários no chat."
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.currentTarget.value)}
            error={nameError}
          />
        </SimpleGrid>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Select
            label="Nível de esforço no chat"
            description="Baixo responde em segundos; níveis altos pensam mais antes de cada resposta ao usuário."
            data={EFFORT_OPTIONS}
            value={chatEffort}
            onChange={(v) => isEffort(v) && setChatEffort(v)}
            allowDeselect={false}
          />
          <Select
            label="Nível de esforço na análise de logs e no FAQ"
            description="Níveis altos aprofundam a análise dos erros e os rascunhos do FAQ, e custam mais tokens."
            data={EFFORT_OPTIONS}
            value={logEffort}
            onChange={(v) => isEffort(v) && setLogEffort(v)}
            allowDeselect={false}
          />
        </SimpleGrid>

        <Divider label="Atendimento no chat do app EYES" labelPosition="left" />
        <Switch
          label="O assistente faz o primeiro atendimento dos chamados abertos pelo app"
          description="Pede a descrição do problema, envia o passo a passo das entradas do FAQ com a tag orientar e encaminha para a equipe quando não há solução conhecida. Para de responder quando um técnico assume o chamado."
          checked={chatEnabled}
          onChange={(e) => setChatEnabled(e.currentTarget.checked)}
        />

        <Divider label="FAQ" labelPosition="left" />
        <Switch
          label="Sugerir entradas do FAQ a partir dos chamados resolvidos"
          description="Quando um técnico resolve um chamado, o assistente escreve a pergunta e o passo a passo da solução, sem dados pessoais. A entrada fica em FAQ → Sugestões até alguém revisar e publicar."
          checked={faqLearn}
          onChange={(e) => setFaqLearn(e.currentTarget.checked)}
        />

        <Divider label="Análise dos erros nos logs" labelPosition="left" />
        <Switch
          label="Analisar periodicamente os erros dos logs das máquinas"
          description="Agrupa os erros repetidos, mede a recorrência e traz a descrição oficial, a causa provável, a resolução e ações sugeridas na plataforma."
          checked={insightsEnabled}
          onChange={(e) => setInsightsEnabled(e.currentTarget.checked)}
        />
        <SimpleGrid cols={{ base: 1, sm: 2 }} maw={640}>
          <NumberInput
            label="Intervalo (horas)"
            description="Cada análise cobre este período"
            min={1}
            max={168}
            allowDecimal={false}
            value={interval}
            onChange={setInterval}
            error={intervalError}
          />
          <Select
            label="Nível mínimo"
            data={LEVEL_OPTIONS}
            value={minLevel}
            onChange={(v) => isInsightLevel(v) && setMinLevel(v)}
            allowDeselect={false}
          />
        </SimpleGrid>
        <Checkbox
          label="Avisar por push os técnicos e administradores que veem todos os clientes"
          description="Chega nos aparelhos com as notificações ligadas e a opção Análises de logs marcada."
          checked={push}
          onChange={(e) => setPush(e.currentTarget.checked)}
        />
        <Checkbox
          label="Enviar também por e-mail"
          description={initial.smtpConfigured ? undefined : 'Configure o servidor SMTP em Notificações para enviar e-mails.'}
          checked={email}
          disabled={!initial.smtpConfigured}
          onChange={(e) => setEmail(e.currentTarget.checked)}
        />
        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            Última análise: {formatDateTime(initial.logInsightsLastRunAt)}
          </Text>
          <Button
            variant="light"
            leftSection={<IconPlayerPlay size={16} />}
            loading={run.isPending}
            disabled={!initial.keySet}
            onClick={() => run.mutate()}
          >
            Analisar agora
          </Button>
        </Group>

        <Alert variant="light" color="gray" icon={<IconShieldLock size={18} />} p="sm">
          <Text size="sm">
            As mensagens dos logs, as conversas do chat e as entradas do FAQ são enviadas à API da Anthropic para gerar as respostas.
            Nenhuma senha ou credencial do cofre é enviada.
          </Text>
        </Alert>
        {needsKey && (
          <Text size="sm" c="red">
            Cadastre a chave da API para ligar o assistente.
          </Text>
        )}
        <Group justify="flex-end">
          <Button
            leftSection={<IconDeviceFloppy size={16} />}
            loading={save.isPending}
            disabled={Boolean(keyError ?? intervalError ?? nameError ?? instructionsError) || needsKey || needsAgent || (model === MODEL_FROM_AGENT && !linkedActive)}
            onClick={() => save.mutate()}
          >
            Salvar
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}

export function AssistantSection() {
  const settings = useQuery({ queryKey: queryKeys.assistantSettings, queryFn: assistantApi.settings });
  return (
    <section aria-labelledby="assistant-settings-title">
      <div>
        <Title order={3} id="assistant-settings-title">
          Assistente de IA
        </Title>
        <Text size="sm" c="dimmed" mb="xs">
          Liga a plataforma ao Claude, da Anthropic, para analisar os erros dos logs das máquinas e fazer o primeiro atendimento no chat do app EYES.
        </Text>
      </div>
      {settings.isError && <LoadError error={settings.error} onRetry={() => void settings.refetch()} />}
      {settings.isPending && <Skeleton height={320} />}
      {settings.data && <AssistantForm key={settings.dataUpdatedAt} initial={settings.data} />}
    </section>
  );
}
