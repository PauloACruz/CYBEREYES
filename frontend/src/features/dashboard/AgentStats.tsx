import { Card, Group, SimpleGrid, Skeleton, Text, ThemeIcon, UnstyledButton } from '@mantine/core';
import { IconDeviceDesktop, type Icon } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { agentsApi } from '../../api/agents';
import { queryKeys } from '../../api/queryKeys';
import type { AgentStatus } from '../../api/types';
import { PATHS } from '../../app/paths';
import { STATUS_INFO } from '../agents/agentFormat';

interface StatDef {
  key: AgentStatus | 'all';
  label: string;
  color: string;
  icon: Icon;
}

const STATS: readonly StatDef[] = [
  { key: 'all', label: 'Agentes', color: 'blue', icon: IconDeviceDesktop },
  ...(['online', 'offline', 'overdue'] as const).map((status) => ({
    key: status,
    label: STATUS_INFO[status].label,
    color: STATUS_INFO[status].color,
    icon: STATUS_INFO[status].icon,
  })),
];

function StatCard({ stat }: { stat: StatDef }) {
  const status = stat.key === 'all' ? undefined : stat.key;
  const count = useQuery({
    queryKey: queryKeys.agentCount(stat.key),
    queryFn: () => agentsApi.list({ page: 1, pageSize: 1, status }),
    select: (data) => data.total,
  });
  const to = status ? `${PATHS.agents}?status=${status}` : PATHS.agents;
  return (
    <UnstyledButton component={Link} to={to} aria-label={`${stat.label}: ver agentes`}>
      <Card withBorder padding="lg">
        <Group justify="space-between" wrap="nowrap">
          <div>
            <Text size="sm" c="dimmed" fw={500}>
              {stat.label}
            </Text>
            {count.isPending ? (
              <Skeleton height={32} width={60} mt={4} />
            ) : (
              <Text fz={32} fw={700} lh={1.2} data-testid={`agent-count-${stat.key}`}>
                {count.data ?? 'Erro'}
              </Text>
            )}
          </div>
          <ThemeIcon size={44} radius="md" variant="light" color={stat.color}>
            <stat.icon size={24} aria-hidden />
          </ThemeIcon>
        </Group>
      </Card>
    </UnstyledButton>
  );
}

export function AgentStats() {
  return (
    <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }} mb="xl" component="section" aria-label="Resumo dos agentes">
      {STATS.map((stat) => (
        <StatCard key={stat.key} stat={stat} />
      ))}
    </SimpleGrid>
  );
}
