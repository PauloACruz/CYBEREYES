import { useState } from 'react';
import { Alert, Badge, Box, Button, Center, Chip, Group, Loader, Skeleton, Stack, Tabs, Text } from '@mantine/core';
import { IconPlugConnectedX, IconRefresh } from '@tabler/icons-react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { agentsApi } from '../../../api/agents';
import { careApi } from '../../../api/care';
import { ApiError } from '../../../api/client';
import { queryKeys } from '../../../api/queryKeys';
import { PERMISSIONS, type AgentDetail, type HealthItem } from '../../../api/types';
import { MOBILE_PATHS, mobileAgentPath, mobileCareRunPath, type MobileCareTab } from '../../../app/paths';
import { hasPermission } from '../../../auth/permissions';
import { useMe } from '../../../auth/useMe';
import { LoadError } from '../../../components/TableStates';
import { formatDateTime } from '../../../lib/format';
import { AgentStatusBadge } from '../../agents/agentDisplay';
import { ModuleForm } from '../../care/CatalogPanel';
import { AGENT_NO_RESPONSE, CARE_NAME, HEALTH_GRADE_INFO, HEALTH_ITEM_INFO, moduleLabel, RUN_STATUS_COLOR, RUN_STATUS_LABEL } from '../../care/careFormat';
import { storeStartedRun, useRunChanged } from '../../care/careRuns';
import { HealthRing } from '../MobileHealth';
import { MobileHeader, MobilePage, MobileSection } from '../MobilePage';
import { MOBILE_CARD } from '../mobileStyles';

const TABS: MobileCareTab[] = ['saude', 'manutencao', 'historico'];
const CATEGORY_LABEL: Record<string, string> = {
  desempenho: 'Desempenho',
  armazenamento: 'Armazenamento',
  estabilidade: 'Estabilidade',
  seguranca: 'Segurança',
};

function isTab(value: string | null): value is MobileCareTab {
  return TABS.includes(value as MobileCareTab);
}

export function MobileCarePage() {
  const { id: rawId } = useParams();
  const id = Number(rawId);
  const valid = Number.isInteger(id) && id > 0;
  const agent = useQuery({ queryKey: queryKeys.agentDetail(id), queryFn: () => agentsApi.get(id), enabled: valid });
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('aba');
  const tab: MobileCareTab = isTab(tabParam) ? tabParam : 'saude';
  useRunChanged();
  const back = { to: valid ? mobileAgentPath(id) : MOBILE_PATHS.agents, label: agent.data?.hostname ?? 'Agente' };

  return (
    <MobilePage header={<MobileHeader title={CARE_NAME} back={back} />}>
      {agent.isError && <LoadError error={agent.error} onRetry={() => void agent.refetch()} />}
      {!agent.data && !agent.isError && (
        <Center py="xl">
          <Loader aria-label="Carregando agente" />
        </Center>
      )}
      {agent.data && (
        <>
          <Group gap={8}>
            <Text ff="monospace" fw={500}>
              {agent.data.hostname}
            </Text>
            <AgentStatusBadge status={agent.data.status} />
            <Text size="sm" c="var(--ce-text-secondary)">
              {agent.data.operatingSystem}
            </Text>
          </Group>
          <Tabs
            value={tab}
            onChange={(value) =>
              setSearchParams(
                (prev) => {
                  const next = new URLSearchParams(prev);
                  if (!value || value === 'saude') next.delete('aba');
                  else next.set('aba', value);
                  return next;
                },
                { replace: true },
              )
            }
            keepMounted={false}
          >
            <Tabs.List grow mb="md">
              <Tabs.Tab value="saude">Saúde</Tabs.Tab>
              <Tabs.Tab value="manutencao">Manutenção</Tabs.Tab>
              <Tabs.Tab value="historico">Histórico</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="saude">
              <HealthTab agentId={agent.data.id} />
            </Tabs.Panel>
            <Tabs.Panel value="manutencao">
              <MaintenanceTab agent={agent.data} />
            </Tabs.Panel>
            <Tabs.Panel value="historico">
              <HistoryTab agentId={agent.data.id} />
            </Tabs.Panel>
          </Tabs>
        </>
      )}
    </MobilePage>
  );
}

function HealthTab({ agentId }: { agentId: number }) {
  const queryClient = useQueryClient();
  const health = useQuery({ queryKey: queryKeys.agentHealth(agentId), queryFn: () => careApi.health(agentId, { silent: true }) });
  const notCollected = health.error instanceof ApiError && health.error.status === 404;
  const collect = useMutation({
    mutationFn: () => careApi.collectHealth(agentId),
    onSuccess: (report) => queryClient.setQueryData(queryKeys.agentHealth(agentId), report),
  });
  const collectButton = (
    <Button variant="light" leftSection={<IconRefresh size={18} />} loading={collect.isPending} onClick={() => collect.mutate()}>
      Coletar agora
    </Button>
  );

  if (health.isPending) return <Skeleton h={160} radius="md" />;
  if (notCollected) {
    return (
      <Stack gap="sm" p={16} style={MOBILE_CARD}>
        <Text>O Health Check ainda não rodou nesta máquina.</Text>
        {collectButton}
      </Stack>
    );
  }
  if (health.isError) return <LoadError error={health.error} onRetry={() => void health.refetch()} />;
  const report = health.data;
  const groups = new Map<string, HealthItem[]>();
  for (const item of report.items) groups.set(item.category, [...(groups.get(item.category) ?? []), item]);

  return (
    <Stack gap="md">
      <Group gap="md" wrap="nowrap" p={16} style={MOBILE_CARD} component="section" aria-label="Nota de saúde">
        <HealthRing score={report.score} grade={report.grade} />
        <Stack gap={6} align="flex-start" style={{ minWidth: 0 }}>
          <Badge color={HEALTH_GRADE_INFO[report.grade].color} variant="filled" size="lg">
            {HEALTH_GRADE_INFO[report.grade].label}
          </Badge>
          <Text size="sm" c="var(--ce-text-secondary)">
            Coletado em {formatDateTime(report.collectedAt)}
          </Text>
          {collectButton}
        </Stack>
      </Group>
      {[...groups.entries()].map(([category, items]) => (
        <MobileSection key={category} title={CATEGORY_LABEL[category] ?? category}>
          <Box style={MOBILE_CARD}>
            {items.map((item, index) => {
              const info = HEALTH_ITEM_INFO[item.status];
              return (
                <Group
                  key={item.key}
                  gap="sm"
                  wrap="nowrap"
                  mih={52}
                  px={16}
                  py={8}
                  style={index > 0 ? { borderTop: '1px solid var(--ce-border-subtle)' } : undefined}
                >
                  <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                    <Text size="md">{item.label}</Text>
                    {(item.value || item.detail) && (
                      <Text size="sm" c="var(--ce-text-secondary)">
                        {[item.value, item.detail].filter(Boolean).join(' · ')}
                      </Text>
                    )}
                  </Stack>
                  <Badge color={info.color} variant="light">
                    {info.label}
                  </Badge>
                </Group>
              );
            })}
          </Box>
        </MobileSection>
      ))}
    </Stack>
  );
}

function MaintenanceTab({ agent }: { agent: AgentDetail }) {
  const { data: me } = useMe();
  const canRun = hasPermission(me, PERMISSIONS.careRun);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const catalog = useQuery({
    queryKey: queryKeys.careCatalog(agent.id),
    queryFn: () => careApi.catalog(agent.id, { silent: true }),
    staleTime: 5 * 60_000,
  });
  const [moduleKey, setModuleKey] = useState<string | null>(null);

  if (catalog.isPending) return <Skeleton h={200} radius="md" />;
  if (catalog.isError) {
    if (catalog.error instanceof ApiError && catalog.error.status === 504) {
      return (
        <Alert color="orange" icon={<IconPlugConnectedX size={18} />} title={AGENT_NO_RESPONSE}>
          <Text size="sm" mb="xs">
            Não foi possível obter o catálogo do {CARE_NAME}. Verifique se a máquina está online.
          </Text>
          <Button size="xs" variant="light" color="orange" onClick={() => void catalog.refetch()}>
            Tentar novamente
          </Button>
        </Alert>
      );
    }
    return <LoadError error={catalog.error} onRetry={() => void catalog.refetch()} />;
  }
  const modules = catalog.data.modules;
  if (modules.length === 0) return <Text c="var(--ce-text-secondary)">Nenhum módulo do {CARE_NAME} disponível para este sistema.</Text>;
  const module = modules.find((m) => m.key === moduleKey) ?? modules[0];
  if (!module) return null;

  return (
    <Stack gap="md">
      <Chip.Group value={module.key} onChange={(v) => setModuleKey(typeof v === 'string' ? v : null)}>
        <Group gap={8} wrap="nowrap" mx={-16} px={16} pb={2} role="group" aria-label="Módulo" style={{ overflowX: 'auto', scrollbarWidth: 'none' }}>
          {modules.map((m) => (
            <Chip key={m.key} value={m.key} variant="outline" size="md" styles={{ label: { whiteSpace: 'nowrap' } }}>
              {m.label}
            </Chip>
          ))}
        </Group>
      </Chip.Group>
      {!canRun && (
        <Text size="sm" c="var(--ce-text-secondary)">
          Seu papel pode ver as tarefas, mas não executar.
        </Text>
      )}
      <Box p={16} style={MOBILE_CARD}>
        <ModuleForm
          key={module.key}
          agentId={agent.id}
          module={module}
          canRun={canRun}
          onStarted={(run) => {
            storeStartedRun(queryClient, run);
            void navigate(mobileCareRunPath(agent.id, run.runId));
          }}
        />
      </Box>
    </Stack>
  );
}

function HistoryTab({ agentId }: { agentId: number }) {
  const runs = useQuery({ queryKey: queryKeys.careRuns(agentId, 1), queryFn: () => careApi.runs(agentId, 1, 20), placeholderData: keepPreviousData });
  const catalog = useQuery({ queryKey: queryKeys.careCatalog(agentId), queryFn: () => careApi.catalog(agentId, { silent: true }), staleTime: 5 * 60_000, retry: false });
  if (runs.isError) return <LoadError error={runs.error} onRetry={() => void runs.refetch()} />;
  if (runs.isPending) return <Skeleton h={160} radius="md" />;
  if (runs.data.items.length === 0) return <Text c="var(--ce-text-secondary)">Nenhuma execução do {CARE_NAME} nesta máquina.</Text>;
  return (
    <Stack gap={8}>
      {runs.data.items.map((run) => (
        <Box
          key={run.runId}
          component={Link}
          to={mobileCareRunPath(agentId, run.runId)}
          p="12px 16px"
          style={{ ...MOBILE_CARD, display: 'flex', flexDirection: 'column', gap: 4, textDecoration: 'none', color: 'inherit' }}
        >
          <Group justify="space-between" gap="xs" wrap="nowrap">
            <Text fw={600} size="md" truncate>
              {moduleLabel(catalog.data, run.module)}
            </Text>
            <Badge color={RUN_STATUS_COLOR[run.status]} variant="light">
              {RUN_STATUS_LABEL[run.status]}
            </Badge>
          </Group>
          <Text size="sm" c="var(--ce-text-secondary)">
            {formatDateTime(run.startedAt)} · {run.tasks.length} {run.tasks.length === 1 ? 'tarefa' : 'tarefas'} · {run.requestedBy}
            {run.source === 'tray' ? ' (app)' : ''}
          </Text>
        </Box>
      ))}
    </Stack>
  );
}
