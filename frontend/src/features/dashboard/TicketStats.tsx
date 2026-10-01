import { Card, Group, SimpleGrid, Skeleton, Text, ThemeIcon, UnstyledButton } from '@mantine/core';
import { IconAlertOctagon, IconTicket, IconUser, IconUserQuestion, type Icon } from '@tabler/icons-react';
import { Link } from 'react-router';
import type { TicketSummary } from '../../api/types';
import { PATHS } from '../../app/paths';
import { useTicketSummary } from '../tickets/useTicketSummary';

interface StatDef {
  key: keyof Omit<TicketSummary, 'byStatus'>;
  label: string;
  color: string;
  icon: Icon;
  to: string;
}

const STATS: readonly StatDef[] = [
  { key: 'open', label: 'Chamados abertos', color: 'blue', icon: IconTicket, to: PATHS.tickets },
  { key: 'unassigned', label: 'Sem técnico', color: 'orange', icon: IconUserQuestion, to: `${PATHS.tickets}?atribuicao=sem-tecnico` },
  { key: 'mine', label: 'Meus chamados', color: 'violet', icon: IconUser, to: `${PATHS.tickets}?atribuicao=meus` },
  { key: 'breached', label: 'SLA estourado', color: 'red', icon: IconAlertOctagon, to: PATHS.tickets },
];

export function TicketStats() {
  const summary = useTicketSummary();
  return (
    <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }} mb="xl" component="section" aria-label="Resumo dos chamados">
      {STATS.map((stat) => (
        <UnstyledButton key={stat.key} component={Link} to={stat.to} aria-label={`${stat.label}: ver chamados`}>
          <Card withBorder padding="lg">
            <Group justify="space-between" wrap="nowrap">
              <div>
                <Text size="sm" c="dimmed" fw={500}>
                  {stat.label}
                </Text>
                {summary.isPending ? (
                  <Skeleton height={32} width={60} mt={4} />
                ) : (
                  <Text fz={32} fw={700} lh={1.2} c={stat.key === 'breached' && (summary.data?.breached ?? 0) > 0 ? 'red' : undefined} data-testid={`ticket-count-${stat.key}`}>
                    {summary.data ? summary.data[stat.key] : 'Erro'}
                  </Text>
                )}
              </div>
              <ThemeIcon size={44} radius="md" variant="light" color={stat.color}>
                <stat.icon size={24} aria-hidden />
              </ThemeIcon>
            </Group>
          </Card>
        </UnstyledButton>
      ))}
    </SimpleGrid>
  );
}
