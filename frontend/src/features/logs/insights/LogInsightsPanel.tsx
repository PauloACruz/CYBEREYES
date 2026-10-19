import { useState } from 'react';
import {
  Accordion,
  Alert,
  Anchor,
  Badge,
  Button,
  Group,
  List,
  Loader,
  Paper,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { IconAlertOctagon, IconAlertTriangle, IconBulb, IconHelpCircle, IconPlayerPlay, IconRobot, IconTrendingDown, IconTrendingUp } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { assistantApi } from '../../../api/assistant';
import { ApiError } from '../../../api/client';
import { queryKeys } from '../../../api/queryKeys';
import { PERMISSIONS, type InsightSeverity, type LogInsightItem, type LogInsightSummaryDto } from '../../../api/types';
import { agentPath, PATHS, ticketPath } from '../../../app/paths';
import { hasPermission } from '../../../auth/permissions';
import { useMe } from '../../../auth/useMe';
import { LoadError } from '../../../components/TableStates';
import { notifySuccess } from '../../../lib/feedback';
import { formatDateTime } from '../../../lib/format';
import { FaqFormModal } from '../../faq/FaqFormModal';
import { numberedSteps } from '../../faq/faqFormat';
import { trendLabel } from './insightFormat';
import { OpenIncidentModal, type IncidentTarget } from './OpenIncidentModal';

const SEVERITY: Record<InsightSeverity, { label: string; color: string }> = {
  critica: { label: 'Crítica', color: 'red' },
  alta: { label: 'Alta', color: 'orange' },
  media: { label: 'Média', color: 'yellow' },
  baixa: { label: 'Baixa', color: 'gray' },
};

const SEVERITY_ORDER: InsightSeverity[] = ['critica', 'alta', 'media', 'baixa'];

/** Incidentes abertos nesta tela, por grupo e maquina, para trocar o botao pelo link. */
type CreatedIncidents = Record<string, number>;

function incidentKey(item: LogInsightItem, agentId: number): string {
  return `${item.group}:${agentId}`;
}

interface MachinesProps {
  item: LogInsightItem;
  canOpen: boolean;
  created: CreatedIncidents;
  onOpen: (target: IncidentTarget) => void;
}

function InsightMachines({ item, canOpen, created, onOpen }: MachinesProps) {
  if (item.machines.length === 0) return null;
  const more = item.agents - item.machines.length;
  return (
    <div>
      <Text size="sm" fw={600} mb={4}>
        Máquinas
      </Text>
      <Table.ScrollContainer minWidth={520}>
        <Table withTableBorder verticalSpacing={4} fz="sm" aria-label={`Máquinas com o erro ${item.title}`}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Máquina</Table.Th>
              <Table.Th>Cliente</Table.Th>
              <Table.Th>Site</Table.Th>
              {canOpen && <Table.Th aria-label="Incidente" />}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {item.machines.map((machine) => {
              const agentId = machine.agentId;
              const ticketId = agentId !== null ? created[incidentKey(item, agentId)] : undefined;
              return (
                <Table.Tr key={agentId ?? machine.hostname}>
                  <Table.Td>
                    {agentId !== null ? (
                      <Anchor component={Link} to={agentPath(agentId)} size="sm">
                        {machine.hostname}
                      </Anchor>
                    ) : (
                      machine.hostname
                    )}
                  </Table.Td>
                  <Table.Td>{machine.client ?? '—'}</Table.Td>
                  <Table.Td>{machine.site ?? '—'}</Table.Td>
                  {canOpen && (
                    <Table.Td ta="right">
                      {ticketId !== undefined ? (
                        <Anchor component={Link} to={ticketPath(ticketId)} size="sm">
                          Incidente #{ticketId}
                        </Anchor>
                      ) : (
                        agentId !== null && (
                          <Button
                            size="compact-xs"
                            variant="light"
                            color="red"
                            leftSection={<IconAlertOctagon size={14} />}
                            aria-label={`Abrir incidente em ${machine.hostname}`}
                            onClick={() => onOpen({ item, machine: { ...machine, agentId } })}
                          >
                            Abrir incidente
                          </Button>
                        )
                      )}
                    </Table.Td>
                  )}
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {more > 0 && (
        <Text size="xs" c="dimmed" mt={4}>
          E mais {more} máquina{more === 1 ? '' : 's'} com o erro.
        </Text>
      )}
    </div>
  );
}

function InsightItemView({ item, ...machines }: Omit<MachinesProps, 'item'> & { item: LogInsightItem }) {
  const severity = SEVERITY[item.severity];
  const trend = trendLabel(item.count, item.previousCount);
  const { data: me } = useMe();
  const [faqOpen, setFaqOpen] = useState(false);
  return (
    <Accordion.Item value={item.group}>
      <Accordion.Control>
        <Group justify="space-between" wrap="nowrap" pr="sm">
          <Stack gap={2}>
            <Group gap="xs">
              <Badge color={severity.color} variant="light" size="sm">
                {severity.label}
              </Badge>
              <Text fw={600} size="sm">
                {item.title}
              </Text>
            </Group>
            <Text size="xs" c="dimmed">
              {item.source}
              {item.eventId !== null ? ` · evento ${item.eventId}` : ''} · {item.level}
            </Text>
          </Stack>
          <Stack gap={0} align="flex-end" miw={170}>
            <Text size="sm" fw={600}>
              {item.count} ocorrência{item.count === 1 ? '' : 's'} · {item.agents} máquina{item.agents === 1 ? '' : 's'}
            </Text>
            <Text size="xs" c="dimmed">
              {item.days} de 7 dias
            </Text>
          </Stack>
        </Group>
      </Accordion.Control>
      <Accordion.Panel>
        <Stack gap="sm">
          <Group gap="xs">
            {trend.up === true && <IconTrendingUp size={16} color="var(--mantine-color-red-6)" aria-hidden />}
            {trend.up === false && <IconTrendingDown size={16} color="var(--mantine-color-teal-6)" aria-hidden />}
            <Text size="sm">
              Recorrência: {trend.text} ({item.previousCount} antes). Primeira vez em {formatDateTime(item.firstSeen)}, última em {formatDateTime(item.lastSeen)}.
            </Text>
          </Group>
          <InsightMachines item={item} {...machines} />
          <Paper withBorder p="xs" bg="var(--mantine-color-default-hover)">
            <Text size="xs" ff="monospace" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {item.sample}
            </Text>
          </Paper>
          {item.officialDescription && (
            <div>
              <Text size="sm" fw={600}>
                Descrição oficial
              </Text>
              <Text size="sm">{item.officialDescription}</Text>
              {item.reference && (
                <Text size="xs" c="dimmed">
                  Fonte: {item.reference}
                </Text>
              )}
            </div>
          )}
          {item.probableCause && (
            <div>
              <Text size="sm" fw={600}>
                Causa provável
              </Text>
              <Text size="sm">{item.probableCause}</Text>
            </div>
          )}
          {item.resolution.length > 0 && (
            <div>
              <Text size="sm" fw={600}>
                Possível resolução
              </Text>
              <List type="ordered" size="sm" spacing={2}>
                {item.resolution.map((step) => (
                  <List.Item key={step}>{step}</List.Item>
                ))}
              </List>
            </div>
          )}
          {item.platformActions.length > 0 && (
            <div>
              <Text size="sm" fw={600}>
                Na plataforma
              </Text>
              <List size="sm" spacing={2}>
                {item.platformActions.map((action) => (
                  <List.Item key={action}>{action}</List.Item>
                ))}
              </List>
            </div>
          )}
          {hasPermission(me, PERMISSIONS.docsView) && item.resolution.length > 0 && (
            <Group justify="flex-end">
              <Button size="xs" variant="light" leftSection={<IconHelpCircle size={14} />} onClick={() => setFaqOpen(true)}>
                Criar entrada no FAQ
              </Button>
            </Group>
          )}
        </Stack>
        <FaqFormModal
          opened={faqOpen}
          onClose={() => setFaqOpen(false)}
          entry={null}
          prefill={{ question: item.title, answer: numberedSteps(item.resolution), category: 'Erros nas máquinas', tags: [], clientId: null }}
        />
      </Accordion.Panel>
    </Accordion.Item>
  );
}

function InsightDetail({ id }: { id: number }) {
  const detail = useQuery({ queryKey: queryKeys.logInsight(id), queryFn: () => assistantApi.insight(id) });
  const { data: me } = useMe();
  const canOpen = hasPermission(me, PERMISSIONS.ticketsManage);
  const [target, setTarget] = useState<IncidentTarget | null>(null);
  const [created, setCreated] = useState<CreatedIncidents>({});
  if (detail.isError) return <LoadError error={detail.error} onRetry={() => void detail.refetch()} />;
  if (!detail.data) return <Skeleton height={240} />;
  const report = detail.data;
  const items = [...report.items].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || b.count - a.count,
  );
  return (
    <Stack gap="md">
      <Paper withBorder p="md">
        <Group justify="space-between" mb="xs" wrap="wrap">
          <Title order={4}>
            {formatDateTime(report.windowStart)} a {formatDateTime(report.windowEnd)}
          </Title>
          <Text size="xs" c="dimmed">
            {report.manual ? 'Pedida manualmente' : 'Análise periódica'} · {report.model}
          </Text>
        </Group>
        {report.status === 'error' && (
          <Alert color="red" icon={<IconAlertTriangle size={18} />} mb="sm" title="A análise não foi concluída">
            {report.error}
          </Alert>
        )}
        <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
          {report.summary}
        </Text>
        <SimpleGrid cols={{ base: 3 }} mt="sm" maw={420}>
          <Stat label="Eventos" value={report.eventCount} />
          <Stat label="Grupos" value={report.groupCount} />
          <Stat label="Máquinas" value={report.agentCount} />
        </SimpleGrid>
      </Paper>
      {items.length > 0 && (
        <Accordion variant="separated" multiple defaultValue={items.slice(0, 1).map((i) => i.group)}>
          {items.map((item) => (
            <InsightItemView key={item.group} item={item} canOpen={canOpen} created={created} onOpen={setTarget} />
          ))}
        </Accordion>
      )}
      <OpenIncidentModal
        report={report}
        target={target}
        onClose={() => setTarget(null)}
        onCreated={(t, ticketId) => setCreated((current) => ({ ...current, [incidentKey(t.item, t.machine.agentId)]: ticketId }))}
      />
      {report.suggestions.length > 0 && (
        <Paper withBorder p="md">
          <Group gap="xs" mb="xs">
            <ThemeIcon variant="light" color="yellow" size="sm">
              <IconBulb size={14} />
            </ThemeIcon>
            <Title order={5}>Sugestões para elevar o suporte</Title>
          </Group>
          <Stack gap="xs">
            {report.suggestions.map((s) => (
              <div key={s.title}>
                <Text size="sm" fw={600}>
                  {s.title}
                </Text>
                <Text size="sm" c="dimmed">
                  {s.detail}
                </Text>
              </div>
            ))}
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fw={600}>{value}</Text>
    </div>
  );
}

function ReportRow({ report, selected, onSelect }: { report: LogInsightSummaryDto; selected: boolean; onSelect: () => void }) {
  return (
    <UnstyledButton
      onClick={onSelect}
      p="sm"
      aria-current={selected}
      style={{
        borderRadius: 'var(--mantine-radius-sm)',
        background: selected ? 'var(--mantine-color-default-hover)' : undefined,
        borderLeft: `3px solid ${selected ? 'var(--mantine-primary-color-filled)' : 'transparent'}`,
      }}
    >
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Text size="sm" fw={600}>
          {formatDateTime(report.createdAt)}
        </Text>
        {report.status === 'error' ? (
          <Badge size="xs" color="red" variant="light">
            Falhou
          </Badge>
        ) : (
          <Badge size="xs" variant="light" color="gray">
            {report.groupCount} grupo{report.groupCount === 1 ? '' : 's'}
          </Badge>
        )}
      </Group>
      <Text size="xs" c="dimmed" lineClamp={2}>
        {report.summary}
      </Text>
    </UnstyledButton>
  );
}

interface Props {
  selectedId: number | undefined;
  onSelect: (id: number) => void;
}

export function LogInsightsPanel({ selectedId, onSelect }: Props) {
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const canRun = hasPermission(me, PERMISSIONS.settingsManage);
  // Relatorio mais recente quando a analise foi pedida; a lista acompanha ate surgir um mais novo.
  const [waitingAfter, setWaitingAfter] = useState<number | null>(null);
  const list = useQuery({
    queryKey: queryKeys.logInsights,
    queryFn: assistantApi.insights,
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.running || (waitingAfter !== null && (data?.reports[0]?.id ?? 0) <= waitingAfter) ? 5000 : false;
    },
  });
  const latest = list.data?.reports[0]?.id ?? 0;
  const waiting = waitingAfter !== null && latest <= waitingAfter;
  const run = useMutation({
    mutationFn: assistantApi.runInsights,
    onSuccess: async () => {
      setWaitingAfter(latest);
      notifySuccess('Análise iniciada. Leva alguns minutos.');
      await queryClient.invalidateQueries({ queryKey: queryKeys.logInsights });
    },
  });

  if (list.isError) {
    if (list.error instanceof ApiError && list.error.status === 403) {
      return (
        <Alert color="gray" variant="light" icon={<IconRobot size={18} />}>
          As análises juntam os logs de todos os clientes e ficam disponíveis só para quem vê todos eles.
        </Alert>
      );
    }
    return <LoadError error={list.error} onRetry={() => void list.refetch()} />;
  }
  if (!list.data) return <Skeleton height={240} />;

  const { reports, configured, enabled, intervalHours } = list.data;
  const running = list.data.running || waiting;
  const current = selectedId ?? reports[0]?.id;

  return (
    <Stack gap="md">
      <Group justify="space-between" wrap="wrap">
        <Text size="sm" c="dimmed">
          {!configured
            ? 'O assistente de IA ainda não foi configurado.'
            : enabled
              ? `O assistente analisa os erros dos logs a cada ${intervalHours} h e avisa a equipe.`
              : 'A análise periódica está desligada; use Analisar agora ou ligue em Configurações.'}{' '}
          <Anchor component={Link} to={PATHS.settings} size="sm">
            Configurações do assistente
          </Anchor>
        </Text>
        {canRun && configured && (
          <Button
            variant="light"
            leftSection={running ? <Loader size={14} /> : <IconPlayerPlay size={16} />}
            loading={run.isPending}
            disabled={running}
            onClick={() => run.mutate()}
          >
            {running ? 'Analisando...' : 'Analisar agora'}
          </Button>
        )}
      </Group>
      {reports.length === 0 ? (
        <Paper withBorder p="xl">
          <Text size="sm" c="dimmed" ta="center">
            Nenhuma análise ainda.
          </Text>
        </Paper>
      ) : (
        <SimpleGrid cols={{ base: 1, md: 4 }} spacing="md">
          <Paper withBorder p={4} style={{ alignSelf: 'start' }}>
            <Stack gap={2} role="list" aria-label="Análises">
              {reports.map((r) => (
                <ReportRow key={r.id} report={r} selected={r.id === current} onSelect={() => onSelect(r.id)} />
              ))}
            </Stack>
          </Paper>
          <div style={{ gridColumn: 'span 3' }}>{current !== undefined && <InsightDetail key={current} id={current} />}</div>
        </SimpleGrid>
      )}
    </Stack>
  );
}
