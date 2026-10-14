import { useState } from 'react';
import { ActionIcon, Badge, Box, Button, Chip, Group, Progress, Skeleton, Stack, Text, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconDotsVertical, IconRefreshAlert, IconSearch, IconUser } from '@tabler/icons-react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { agentsApi } from '../../../api/agents';
import { queryKeys } from '../../../api/queryKeys';
import type { AgentListItem, AgentStatus, ListAgentsParams } from '../../../api/types';
import { mobileAgentPath } from '../../../app/paths';
import { LoadError } from '../../../components/TableStates';
import { formatRelative } from '../../../lib/format';
import { AgentStatusBadge } from '../../agents/agentDisplay';
import { loggedUser, platformInfo, STATUS_INFO } from '../../agents/agentFormat';
import { HealthNumber } from '../MobileHealth';
import { MobileHeader, MobilePage } from '../MobilePage';
import { MOBILE_CARD } from '../mobileStyles';
import { MobileAgentActions, type MobileAgentRef } from './MobileAgentActions';

const PAGE_STEP = 30;
const STATUSES: AgentStatus[] = ['online', 'overdue', 'offline'];

function isStatus(value: string | null): value is AgentStatus {
  return STATUSES.includes(value as AgentStatus);
}

/** Contagem por status (mesma consulta dos cartoes antigos do Painel: so o total). */
function useAgentCount(status: AgentStatus | 'all') {
  return useQuery({
    queryKey: queryKeys.agentCount(status),
    queryFn: () => agentsApi.list({ page: 1, pageSize: 1, status: status === 'all' ? undefined : status }),
    select: (data) => data.total,
    staleTime: 30_000,
  });
}

function AgentCard({ agent, onActions }: { agent: AgentListItem; onActions: () => void }) {
  const platform = platformInfo(agent.plat);
  const user = loggedUser(agent);
  return (
    <Box pos="relative">
      <Box
        component={Link}
        to={mobileAgentPath(agent.id)}
        aria-label={`${agent.hostname}: ${STATUS_INFO[agent.status].label}`}
        p="14px 52px 14px 16px"
        style={{ ...MOBILE_CARD, display: 'flex', gap: 12, textDecoration: 'none', color: 'inherit' }}
      >
        <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
          <Group gap={8}>
            <AgentStatusBadge status={agent.status} />
            {agent.needsReboot && (
              <Badge color="yellow" variant="light" leftSection={<IconRefreshAlert size={12} aria-hidden />}>
                Reinício pendente
              </Badge>
            )}
          </Group>
          <Text ff="monospace" fw={500} size="md" truncate>
            {agent.hostname}
          </Text>
          <Text size="sm" c="var(--ce-text-secondary)" truncate>
            {agent.clientName} · {agent.siteName}
          </Text>
          <Group gap={12} c="var(--ce-text-secondary)" wrap="nowrap">
            <platform.icon size={16} role="img" aria-label={agent.operatingSystem || platform.label} />
            <Group gap={4} wrap="nowrap">
              <IconUser size={14} aria-hidden />
              <Text span size="sm" truncate>
                {user ?? 'Nenhum'}
              </Text>
            </Group>
            <Text span size="sm" style={{ whiteSpace: 'nowrap' }}>
              {formatRelative(agent.lastSeen)}
            </Text>
          </Group>
        </Stack>
        <Box style={{ display: 'flex', alignItems: 'center' }}>
          <HealthNumber score={agent.healthScore} grade={agent.healthGrade} />
        </Box>
      </Box>
      <ActionIcon variant="subtle" color="gray" size={44} pos="absolute" top={6} right={4} aria-label={`Ações de ${agent.hostname}`} onClick={onActions}>
        <IconDotsVertical size={20} />
      </ActionIcon>
    </Box>
  );
}

/** Estacoes online frente ao total, filtro por status, busca e acoes por agente. */
export function MobileAgentsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const statusParam = searchParams.get('status');
  const status = isStatus(statusParam) ? statusParam : undefined;
  const [search, setSearch] = useState(searchParams.get('busca') ?? '');
  const [debounced] = useDebouncedValue(search.trim(), 300);
  const [pageSize, setPageSize] = useState(PAGE_STEP);
  const [actionsFor, setActionsFor] = useState<MobileAgentRef | null>(null);

  const total = useAgentCount('all');
  const counts = { online: useAgentCount('online'), overdue: useAgentCount('overdue'), offline: useAgentCount('offline') };
  const params: ListAgentsParams = { page: 1, pageSize, status, search: debounced || undefined, sortBy: 'status' };
  const agents = useQuery({ queryKey: queryKeys.agentList(params), queryFn: () => agentsApi.list(params), placeholderData: keepPreviousData });
  const items = agents.data?.items ?? [];
  const all = total.data ?? 0;

  const setParam = (key: string, value: string | undefined) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  return (
    <MobilePage header={<MobileHeader title="Agentes" />}>
      <Box component="section" aria-label="Estações online frente ao total" p={16} style={MOBILE_CARD}>
        <Group justify="space-between" align="baseline" mb={10}>
          <Text c="var(--ce-text-secondary)">Online agora</Text>
          <Text>
            <Text span fz={28} fw={700} lh="32px">
              {counts.online.data ?? '–'}
            </Text>
            <Text span c="var(--ce-text-secondary)">
              {' '}
              de {total.data ?? '–'}
            </Text>
          </Text>
        </Group>
        <Progress.Root size={10} aria-hidden>
          {STATUSES.map((s) => (
            <Progress.Section key={s} value={all > 0 ? ((counts[s].data ?? 0) / all) * 100 : 0} color={STATUS_INFO[s].color} />
          ))}
        </Progress.Root>
      </Box>
      <Chip.Group value={status ?? 'todos'} onChange={(v) => setParam('status', isStatus(v) ? v : undefined)}>
        <Group gap={8} wrap="nowrap" mx={-16} px={16} pb={2} role="group" aria-label="Filtrar por status" style={{ overflowX: 'auto', scrollbarWidth: 'none' }}>
          <Chip value="todos" variant="outline" size="md">
            Todos
            <Text span size="xs" fw={700} ml={6}>
              {total.data ?? ''}
            </Text>
          </Chip>
          {STATUSES.map((s) => (
            <Chip key={s} value={s} variant="outline" size="md" color={STATUS_INFO[s].color}>
              {STATUS_INFO[s].label}
              <Text span size="xs" fw={700} ml={6}>
                {counts[s].data ?? ''}
              </Text>
            </Chip>
          ))}
        </Group>
      </Chip.Group>
      <TextInput
        aria-label="Buscar agentes"
        placeholder="Hostname, usuário, responsável ou IP"
        leftSection={<IconSearch size={18} />}
        size="md"
        value={search}
        onChange={(e) => {
          setSearch(e.currentTarget.value);
          setParam('busca', e.currentTarget.value.trim() || undefined);
        }}
      />
      {agents.isError && <LoadError error={agents.error} onRetry={() => void agents.refetch()} />}
      {agents.isPending && (
        <Stack gap={10}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} h={120} radius="md" />
          ))}
        </Stack>
      )}
      {agents.isSuccess && items.length === 0 && (
        <Text c="var(--ce-text-secondary)" ta="center" py="xl">
          {debounced || status ? 'Nenhum agente encontrado com esses filtros.' : 'Nenhum agente instalado ainda.'}
        </Text>
      )}
      <Stack gap={10} style={{ opacity: agents.isPlaceholderData ? 0.6 : 1 }}>
        {items.map((agent) => (
          <AgentCard key={agent.id} agent={agent} onActions={() => setActionsFor(agent)} />
        ))}
      </Stack>
      {agents.data && agents.data.total > items.length && (
        <Button variant="default" size="md" fullWidth loading={agents.isFetching} onClick={() => setPageSize((n) => n + PAGE_STEP)}>
          Carregar mais agentes ({items.length} de {agents.data.total})
        </Button>
      )}
      <MobileAgentActions agent={actionsFor} onClose={() => setActionsFor(null)} />
    </MobilePage>
  );
}
