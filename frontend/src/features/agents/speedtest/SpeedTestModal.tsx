import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Center,
  Grid,
  Group,
  Loader,
  Modal,
  NumberInput,
  Paper,
  Progress,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
  ThemeIcon,
  UnstyledButton,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconCheck, IconGauge, IconLoader2, IconPlayerPlay } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../../api/queryKeys';
import { SPEED_TEST_MIN_VERSION, speedTestsApi } from '../../../api/speedTests';
import type { AgentDetail, SpeedTestMode, SpeedTestSummary } from '../../../api/types';
import { LoadError } from '../../../components/TableStates';
import { formatDateTime } from '../../../lib/format';
import { versionAtLeast } from '../../snmp/snmpFormat';
import { SpeedTestReportView } from './SpeedTestReportView';
import { formatMbps, formatMs, PHASES, STATUS_INFO } from './speedTestFormat';

interface SpeedTestModalProps {
  agent: Pick<AgentDetail, 'id' | 'hostname' | 'version'>;
  opened: boolean;
  /** Iniciar exige agents.control; o historico e os relatorios so agents.view. */
  canStart: boolean;
  onClose: () => void;
}

const isActive = (t: SpeedTestSummary | undefined) => t?.status === 'pending' || t?.status === 'running';

export function SpeedTestModal({ agent, opened, canStart, onClose }: SpeedTestModalProps) {
  const fullScreen = useMediaQuery('(max-width: 48em)');
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <IconGauge size={20} />
          <Text fw={600}>Teste de velocidade · {agent.hostname}</Text>
        </Group>
      }
      size={1180}
      fullScreen={fullScreen}
      centered
    >
      {opened && <SpeedTestPanel agent={agent} canStart={canStart} />}
    </Modal>
  );
}

function SpeedTestPanel({ agent, canStart }: Omit<SpeedTestModalProps, 'opened' | 'onClose'>) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<number | null>(null);
  const [mode, setMode] = useState<SpeedTestMode>('full');
  const [plan, setPlan] = useState<{ down: number | string; up: number | string } | null>(null);
  const supported = versionAtLeast(agent.version, SPEED_TEST_MIN_VERSION);

  const list = useQuery({
    queryKey: queryKeys.agentSpeedTests(agent.id),
    queryFn: () => speedTestsApi.list(agent.id),
    refetchInterval: (q) => (q.state.data?.some(isActive) ? 3000 : false),
  });
  const tests = list.data ?? [];
  const current = selected ?? tests[0]?.id ?? null;
  // O plano do ultimo teste vem preenchido: a maquina costuma ficar no mesmo link.
  const lastPlan = tests.find((t) => t.planDownloadMbps !== null || t.planUploadMbps !== null);
  const planValues = plan ?? { down: lastPlan?.planDownloadMbps ?? '', up: lastPlan?.planUploadMbps ?? '' };

  const start = useMutation({
    mutationFn: () =>
      speedTestsApi.start(agent.id, {
        mode,
        planDownloadMbps: typeof planValues.down === 'number' && planValues.down > 0 ? planValues.down : null,
        planUploadMbps: typeof planValues.up === 'number' && planValues.up > 0 ? planValues.up : null,
      }),
    onSuccess: async (test) => {
      setSelected(test.id);
      await queryClient.invalidateQueries({ queryKey: queryKeys.agentSpeedTests(agent.id) });
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: queryKeys.agentSpeedTests(agent.id) }),
  });
  const running = tests.some(isActive);

  return (
    <Stack gap="md">
      {!supported && (
        <Alert color="yellow" variant="light" title={`Disponível a partir do EYES ${SPEED_TEST_MIN_VERSION}`}>
          Esta máquina está com o EYES {agent.version || 'desconhecido'}. Use Ações › Atualizar EYES e tente de novo; os testes anteriores continuam abaixo.
        </Alert>
      )}
      {canStart && supported && (
        <Paper withBorder p="sm">
          <Group align="flex-end" gap="md" wrap="wrap">
            <Stack gap={4}>
              <Text size="sm" fw={500}>
                Tipo de teste
              </Text>
              <SegmentedControl
                value={mode}
                onChange={setMode}
                data={[
                  { value: 'full', label: 'Completo (~45 s)' },
                  { value: 'quick', label: 'Rápido (~20 s)' },
                ]}
              />
            </Stack>
            <NumberInput
              label="Download contratado"
              description="Opcional, para comparar"
              suffix=" Mbit/s"
              min={0}
              max={100000}
              w={190}
              value={planValues.down}
              onChange={(v) => setPlan({ ...planValues, down: v })}
            />
            <NumberInput
              label="Upload contratado"
              description="Opcional"
              suffix=" Mbit/s"
              min={0}
              max={100000}
              w={190}
              value={planValues.up}
              onChange={(v) => setPlan({ ...planValues, up: v })}
            />
            <Button leftSection={<IconPlayerPlay size={16} />} loading={start.isPending} disabled={running} onClick={() => start.mutate()}>
              Iniciar teste
            </Button>
          </Group>
          <Text size="xs" c="dimmed" mt="xs">
            {mode === 'full'
              ? 'Mede rede local, Wi-Fi, latência, perda, DNS, download e upload com uma e com várias conexões e a latência sob carga. Ocupa a banda por cerca de 15 s em cada sentido e pode transferir de dezenas a centenas de MB conforme a velocidade: evite em links com franquia.'
              : 'Mede rede local, latência, perda, DNS, download e upload com uma conexão, transferindo menos dados. Sem a fase de várias conexões nem a latência sob carga.'}
          </Text>
        </Paper>
      )}

      {list.isError && <LoadError error={list.error} onRetry={() => void list.refetch()} />}
      {list.isPending && (
        <Center py="xl">
          <Loader aria-label="Carregando testes" />
        </Center>
      )}
      {list.isSuccess && tests.length === 0 && (
        <Text c="dimmed" ta="center" py="xl">
          Nenhum teste de velocidade feito nesta máquina ainda.
        </Text>
      )}
      {tests.length > 0 && current !== null && (
        <Grid gap="md">
          <Grid.Col span={{ base: 12, md: 3 }}>
            <Text size="sm" fw={600} mb="xs">
              Histórico
            </Text>
            <ScrollArea.Autosize mah={{ base: 220, md: '70vh' }} type="auto">
              <Stack gap={6}>
                {tests.map((t) => (
                  <HistoryItem key={t.id} test={t} active={t.id === current} onSelect={() => setSelected(t.id)} />
                ))}
              </Stack>
            </ScrollArea.Autosize>
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 9 }}>
            <SelectedTest agentId={agent.id} testId={current} />
          </Grid.Col>
        </Grid>
      )}
    </Stack>
  );
}

function HistoryItem({ test, active, onSelect }: { test: SpeedTestSummary; active: boolean; onSelect: () => void }) {
  const status = STATUS_INFO[test.status];
  return (
    <UnstyledButton
      onClick={onSelect}
      aria-current={active || undefined}
      p="xs"
      style={{
        borderRadius: 'var(--mantine-radius-sm)',
        border: `1px solid ${active ? 'var(--mantine-primary-color-filled)' : 'var(--mantine-color-default-border)'}`,
        background: active ? 'var(--mantine-primary-color-light)' : undefined,
      }}
    >
      <Group justify="space-between" gap={4} wrap="nowrap">
        <Text size="xs" fw={500}>
          {formatDateTime(test.createdAt, '')}
        </Text>
        {test.status !== 'completed' && (
          <Badge size="xs" color={status.color} variant="light">
            {status.label}
          </Badge>
        )}
      </Group>
      {test.status === 'completed' ? (
        <Text size="xs" c="dimmed" style={{ fontVariantNumeric: 'tabular-nums' }}>
          ↓ {formatMbps(test.downloadMbps)} · ↑ {formatMbps(test.uploadMbps)} · {formatMs(test.latencyMs)}
        </Text>
      ) : (
        <Text size="xs" c="dimmed" lineClamp={1}>
          {test.status === 'failed' ? test.error : `${test.progress}%`}
        </Text>
      )}
    </UnstyledButton>
  );
}

function SelectedTest({ agentId, testId }: { agentId: number; testId: number }) {
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: queryKeys.agentSpeedTest(agentId, testId),
    queryFn: async () => {
      const d = await speedTestsApi.get(agentId, testId);
      // Fim do teste: a lista (historico) passa a mostrar os numeros.
      if (!isActive(d.test)) void queryClient.invalidateQueries({ queryKey: queryKeys.agentSpeedTests(agentId), exact: true });
      return d;
    },
    refetchInterval: (q) => (isActive(q.state.data?.test) ? 1500 : false),
  });

  if (detail.isPending) {
    return (
      <Center py="xl">
        <Loader aria-label="Carregando teste" />
      </Center>
    );
  }
  if (detail.isError) return <LoadError error={detail.error} onRetry={() => void detail.refetch()} />;
  const { test } = detail.data;
  if (isActive(test)) return <RunningView test={test} />;
  return (
    <Stack gap="md">
      {test.status === 'failed' && (
        <Alert color="red" variant="light" title="O teste falhou">
          {test.error}
        </Alert>
      )}
      <SpeedTestReportView detail={detail.data} />
    </Stack>
  );
}

/** Andamento ao vivo: fases, porcentagem e a velocidade medida no momento. */
function RunningView({ test }: { test: SpeedTestSummary }) {
  const phaseIndex = test.phase ? PHASES.findIndex((p) => p.value === test.phase) : -1;
  const transferring = test.phase === 'download' || test.phase === 'upload';
  return (
    <Paper withBorder p="lg">
      <Stack gap="lg">
        <Group justify="space-between">
          <Text fw={600}>{test.status === 'pending' ? 'Aguardando o EYES começar o teste...' : 'Medindo a conexão desta máquina'}</Text>
          <Text fw={700} style={{ fontVariantNumeric: 'tabular-nums' }}>
            {test.progress}%
          </Text>
        </Group>
        <Progress value={Math.max(test.progress, 2)} animated size="lg" aria-label="Andamento do teste" />
        {transferring && (
          <Center>
            <Stack gap={0} align="center">
              <Text size="sm" c="dimmed">
                {test.phase === 'download' ? 'Download' : 'Upload'} agora
              </Text>
              <Text fz={40} fw={700} style={{ fontVariantNumeric: 'tabular-nums' }} aria-live="polite">
                {formatMbps(test.liveMbps ?? 0)}
              </Text>
            </Stack>
          </Center>
        )}
        <Stack gap="xs">
          {PHASES.map((p, i) => {
            const done = phaseIndex > i;
            const now = phaseIndex === i;
            return (
              <Group key={p.value} gap="sm">
                <ThemeIcon size="sm" radius="xl" color={done ? 'teal' : now ? 'blue' : 'gray'} variant={done || now ? 'filled' : 'light'}>
                  {done ? <IconCheck size={12} /> : now ? <IconLoader2 size={12} /> : <span />}
                </ThemeIcon>
                <Text size="sm" c={done || now ? undefined : 'dimmed'} fw={now ? 600 : undefined}>
                  {p.label}
                </Text>
              </Group>
            );
          })}
        </Stack>
        <Text size="xs" c="dimmed">
          Pedido por {test.requestedBy} em {formatDateTime(test.createdAt, '')}. Pode fechar esta janela: o teste continua e o relatório fica no histórico.
        </Text>
      </Stack>
    </Paper>
  );
}
