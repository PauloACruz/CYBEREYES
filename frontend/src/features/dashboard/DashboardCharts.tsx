import { useState, type ReactNode } from 'react';
import { Anchor, Card, Chip, Group, Progress, RingProgress, SimpleGrid, Stack, Text, Tooltip } from '@mantine/core';
import { Link } from 'react-router';
import type { DashboardAgents, DashboardChecks, DashboardProcedures, DashboardTickets } from '../../api/types';
import { PATHS } from '../../app/paths';
import { StackedBarChart, type StackKey } from '../../components/charts/StackedBarChart';
import { formatInteger } from '../../lib/format';
import { formatTotalSeconds, PROCEDURE_KIND_INFO } from '../procedures/procedureFormat';

const ONLINE = 'var(--mantine-color-teal-5)';
const OVERDUE = 'var(--mantine-color-orange-5)';
const OFFLINE = 'var(--mantine-color-red-6)';
const OPENED = 'var(--mantine-color-gold-5)';
const RESOLVED = 'var(--ce-chart-1)';

/** Dia (AAAA-MM-DD, fuso do console) ao meio-dia local, para o grafico nao trocar de dia pelo fuso do navegador. */
const dayTime = (date: string) => `${date}T12:00:00`;
const dayTooltip = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
const percent = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

function ChartCard({ title, link, children }: { title: string; link?: { to: string; label: string }; children: ReactNode }) {
  return (
    <Card withBorder padding="lg" component="section" aria-label={title} h="100%">
      <Group justify="space-between" mb="md" wrap="wrap">
        <Text fw={600}>{title}</Text>
        {link && (
          <Anchor component={Link} to={link.to} size="sm">
            {link.label}
          </Anchor>
        )}
      </Group>
      <Stack gap="md">{children}</Stack>
    </Card>
  );
}

function Stat({ label, value, color, to }: { label: string; value: number | string; color?: string; to?: string }) {
  const number = (
    <Text fz={24} fw={700} lh={1.2} c={color} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {typeof value === 'number' ? formatInteger(value) : value}
    </Text>
  );
  return (
    <div>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      {to ? (
        <Anchor component={Link} to={to} underline="never" aria-label={`${label}: ${value}`}>
          {number}
        </Anchor>
      ) : (
        number
      )}
    </div>
  );
}

/** Chips que ligam e desligam as series do grafico (a cor sempre acompanha o nome). */
function SeriesToggle<K extends string>({ keys, hidden, onChange }: { keys: StackKey<K>[]; hidden: K[]; onChange: (hidden: K[]) => void }) {
  return (
    <Group gap="xs" role="group" aria-label="Séries do gráfico">
      {keys.map((k) => {
        const on = !hidden.includes(k.key);
        return (
          <Chip
            key={k.key}
            size="xs"
            variant="outline"
            checked={on}
            onChange={() => onChange(on ? [...hidden, k.key] : hidden.filter((h) => h !== k.key))}
            icon={<span aria-hidden style={{ width: 8, height: 8, borderRadius: 2, background: k.color, display: 'inline-block' }} />}
          >
            {k.label}
          </Chip>
        );
      })}
    </Group>
  );
}

export function AgentsOnlineCard({ agents }: { agents: DashboardAgents }) {
  const total = Math.max(agents.total, 1);
  const parts = [
    { key: 'online', label: 'Online', value: agents.online, color: ONLINE },
    { key: 'overdue', label: 'Em atraso', value: agents.overdue, color: OVERDUE },
    { key: 'offline', label: 'Offline', value: agents.offline, color: OFFLINE },
  ];
  return (
    <ChartCard title="Estações online frente ao total" link={{ to: PATHS.agents, label: 'Ver agentes' }}>
      <Group gap="lg" wrap="wrap">
        <RingProgress
          size={140}
          thickness={14}
          roundCaps={false}
          aria-label={`${agents.online} de ${agents.total} estações online`}
          sections={parts.filter((p) => p.value > 0).map((p) => ({ value: (p.value / total) * 100, color: p.color, tooltip: `${p.label}: ${p.value}` }))}
          label={
            <Stack gap={0} align="center">
              <Text fz={26} fw={700} lh={1}>
                {agents.online}
              </Text>
              <Text size="xs" c="dimmed">
                de {agents.total} online
              </Text>
            </Stack>
          }
        />
        <Stack gap={6} miw={180}>
          {parts.map((p) => (
            <Anchor key={p.key} component={Link} to={`${PATHS.agents}?status=${p.key}`} c="var(--mantine-color-text)" underline="never">
              <Group gap={8} wrap="nowrap">
                <span aria-hidden style={{ width: 10, height: 10, borderRadius: 2, background: p.color, display: 'inline-block' }} />
                <Text size="sm" style={{ flex: 1 }}>
                  {p.label}
                </Text>
                <Text size="sm" fw={700}>
                  {p.value}
                </Text>
                <Text size="xs" c="dimmed" w={44} ta="right">
                  {percent.format((p.value / total) * 100)}%
                </Text>
              </Group>
            </Anchor>
          ))}
        </Stack>
      </Group>
      {agents.byClient.length > 1 && (
        <Stack gap={8}>
          <Text size="sm" fw={600}>
            Por cliente
          </Text>
          {agents.byClient.map((c) => (
            <Group key={c.clientId} gap="sm" wrap="nowrap">
              <Text size="sm" w={160} truncate="end" title={c.clientName}>
                {c.clientName}
              </Text>
              <Progress.Root size={10} style={{ flex: 1 }} aria-label={`${c.clientName}: ${c.online} de ${c.total} online`}>
                {[
                  { label: 'Online', value: c.online, color: ONLINE },
                  { label: 'Em atraso', value: c.overdue, color: OVERDUE },
                  { label: 'Offline', value: c.offline, color: OFFLINE },
                ].map((s) => (
                  <Tooltip key={s.label} label={`${s.label}: ${s.value}`} withArrow>
                    <Progress.Section value={(s.value / Math.max(c.total, 1)) * 100} color={s.color} />
                  </Tooltip>
                ))}
              </Progress.Root>
              <Text size="xs" c="dimmed" w={56} ta="right">
                {c.online}/{c.total}
              </Text>
            </Group>
          ))}
        </Stack>
      )}
    </ChartCard>
  );
}

type TicketKey = 'opened' | 'resolved';
const TICKET_KEYS: StackKey<TicketKey>[] = [
  { key: 'opened', label: 'Abertos', color: OPENED },
  { key: 'resolved', label: 'Resolvidos', color: RESOLVED },
];

export function TicketsCard({ tickets, technicianFiltered }: { tickets: DashboardTickets; technicianFiltered: boolean }) {
  const [hidden, setHidden] = useState<TicketKey[]>([]);
  const keys = TICKET_KEYS.filter((k) => !hidden.includes(k.key));
  return (
    <ChartCard title="Chamados" link={{ to: PATHS.tickets, label: 'Ver chamados' }}>
      <SimpleGrid cols={{ base: 2, sm: 4 }}>
        <Stat label="Abertos agora" value={tickets.open} />
        {technicianFiltered ? (
          <Stat label="Abertos no período" value={tickets.openedInPeriod} color="gold.6" />
        ) : (
          <Stat label="Sem técnico" value={tickets.unassigned} color={tickets.unassigned > 0 ? 'orange.6' : undefined} to={`${PATHS.tickets}?atribuicao=sem-tecnico`} />
        )}
        <Stat label="SLA estourado" value={tickets.breached} color={tickets.breached > 0 ? 'red.6' : undefined} />
        <Stat label="Resolvidos no período" value={tickets.resolvedInPeriod} color="blue.5" />
      </SimpleGrid>
      <Group justify="space-between" wrap="wrap">
        <Text size="sm" fw={600}>
          Abertos e resolvidos por dia
        </Text>
        <SeriesToggle keys={TICKET_KEYS} hidden={hidden} onChange={setHidden} />
      </Group>
      <StackedBarChart
        mode="grouped"
        label="Chamados abertos e resolvidos por dia"
        keys={keys}
        tooltipFormat={dayTooltip}
        buckets={tickets.days.map((d) => ({ time: dayTime(d.date), values: { opened: d.opened, resolved: d.resolved } }))}
      />
    </ChartCard>
  );
}

type CheckKey = 'passing' | 'failing';
const CHECK_KEYS: StackKey<CheckKey>[] = [
  { key: 'passing', label: 'Sucesso', color: ONLINE },
  { key: 'failing', label: 'Falha', color: OFFLINE },
];

export function ChecksCard({ checks, days }: { checks: DashboardChecks; days: number }) {
  const [hidden, setHidden] = useState<CheckKey[]>([]);
  const keys = CHECK_KEYS.filter((k) => !hidden.includes(k.key));
  const rate = checks.total > 0 ? `${percent.format((checks.passing / checks.total) * 100)}%` : 'Sem dados';
  return (
    <ChartCard title="Checks realizados por período">
      <SimpleGrid cols={{ base: 2, sm: 4 }}>
        <Stat label="Checks no período" value={checks.total} />
        <Stat label="Com sucesso" value={checks.passing} color="teal.6" />
        <Stat label="Com falha" value={checks.failing} color={checks.failing > 0 ? 'red.6' : undefined} />
        <Stat label="Taxa de sucesso" value={rate} />
      </SimpleGrid>
      <Group justify="space-between" wrap="wrap">
        <Text size="sm" fw={600}>
          Execuções por dia
        </Text>
        <SeriesToggle keys={CHECK_KEYS} hidden={hidden} onChange={setHidden} />
      </Group>
      <StackedBarChart
        label="Checks executados por dia, com sucesso e com falha"
        keys={keys}
        tooltipFormat={dayTooltip}
        buckets={checks.days.map((d) => ({ time: dayTime(d.date), values: { passing: d.passing, failing: d.failing } }))}
      />
      {days > checks.historyDays && (
        <Text size="xs" c="dimmed">
          O servidor guarda {checks.historyDays} dias de histórico de checks; os dias mais antigos aparecem vazios.
        </Text>
      )}
    </ChartCard>
  );
}

type ProcedureKey = 'count';
const PROCEDURE_KEYS: StackKey<ProcedureKey>[] = [{ key: 'count', label: 'Procedimentos', color: RESOLVED }];

/** Linha de ranking: nome em texto, numero ao lado e uma barra de uma cor so (a identidade vem do nome, nao da cor). */
function RankRow({ label, count, max, hint }: { label: ReactNode; count: number; max: number; hint: string }) {
  return (
    <Stack gap={4}>
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Text size="sm" truncate>
          {label}
        </Text>
        <Text size="sm" c="dimmed" style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
          {formatInteger(count)} · {hint}
        </Text>
      </Group>
      <Progress value={max > 0 ? (count / max) * 100 : 0} size={6} color={RESOLVED} aria-hidden />
    </Stack>
  );
}

/** Procedimentos feitos nos agentes no periodo: quantos, quanto tempo, quantos ja entraram em chamado, por dia, tipo e tecnico. */
export function ProceduresCard({ procedures, technicianFiltered }: { procedures: DashboardProcedures; technicianFiltered: boolean }) {
  const kinds = procedures.byKind.slice(0, 6);
  const users = procedures.byUser.slice(0, 6);
  const maxKind = Math.max(0, ...kinds.map((k) => k.count));
  const maxUser = Math.max(0, ...users.map((u) => u.count));
  return (
    <ChartCard title="Procedimentos nos agentes" link={{ to: PATHS.procedures, label: 'Ver procedimentos' }}>
      <SimpleGrid cols={{ base: 2, sm: 4 }}>
        <Stat label="No período" value={procedures.total} />
        <Stat label="Tempo de execução" value={formatTotalSeconds(procedures.seconds)} />
        <Stat label="Em chamados" value={procedures.inTickets} color="blue.5" />
        <Stat
          label="Sem chamado"
          value={procedures.unlinked}
          color={procedures.unlinked > 0 ? 'orange.6' : undefined}
          to={`${PATHS.procedures}?chamado=sem-chamado`}
        />
      </SimpleGrid>
      <Text size="sm" fw={600}>
        Procedimentos por dia
      </Text>
      <StackedBarChart
        label="Procedimentos feitos nos agentes por dia"
        keys={PROCEDURE_KEYS}
        tooltipFormat={dayTooltip}
        buckets={procedures.days.map((d) => ({ time: dayTime(d.date), values: { count: d.count } }))}
      />
      {procedures.total > 0 && (
        <SimpleGrid cols={{ base: 1, sm: technicianFiltered ? 1 : 2 }} spacing="xl">
          <Stack gap="sm" component="section" aria-label="Procedimentos por tipo">
            <Text size="sm" fw={600}>
              Por tipo
            </Text>
            {kinds.map((k) => (
              <RankRow key={k.kind} label={PROCEDURE_KIND_INFO[k.kind].label} count={k.count} max={maxKind} hint={formatTotalSeconds(k.seconds)} />
            ))}
          </Stack>
          {!technicianFiltered && (
            <Stack gap="sm" component="section" aria-label="Procedimentos por técnico">
              <Text size="sm" fw={600}>
                Por técnico
              </Text>
              {users.map((u) => (
                <RankRow key={u.userId ?? u.userName} label={u.userName} count={u.count} max={maxUser} hint={formatTotalSeconds(u.seconds)} />
              ))}
            </Stack>
          )}
        </SimpleGrid>
      )}
    </ChartCard>
  );
}
