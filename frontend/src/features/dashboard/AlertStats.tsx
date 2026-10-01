import { Anchor, Card, Group, SimpleGrid, Skeleton, Stack, Text, ThemeIcon, UnstyledButton } from '@mantine/core';
import { IconChecklist } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { alertsApi } from '../../api/alerts';
import { queryKeys } from '../../api/queryKeys';
import type { Severity } from '../../api/types';
import { PATHS } from '../../app/paths';
import { AlertTarget } from '../alerts/AlertTarget';
import { SEVERITIES, SEVERITY_INFO } from '../monitoring/monitoringFormat';

const CHECK_SAMPLE = 200;
const CHECK_LIST = 5;

function SeverityCount({ severity }: { severity: Severity }) {
  const info = SEVERITY_INFO[severity];
  const count = useQuery({
    queryKey: queryKeys.alertSeverityCount(severity),
    queryFn: () => alertsApi.list({ status: 'active', severity, page: 1, pageSize: 1 }),
    select: (data) => data.total,
  });
  return (
    <UnstyledButton component={Link} to={`${PATHS.alerts}?severidade=${severity}`} aria-label={`${info.label}: ver alertas ativos`}>
      <Group gap="sm" wrap="nowrap">
        <ThemeIcon size={36} radius="md" variant="light" color={info.color}>
          <info.icon size={20} aria-hidden />
        </ThemeIcon>
        <div>
          <Text size="xs" c="dimmed" fw={500}>
            {info.label}
          </Text>
          {count.isPending ? (
            <Skeleton height={26} width={40} />
          ) : (
            <Text fz={24} fw={700} lh={1.1} data-testid={`alert-count-${severity}`}>
              {count.data ?? 'Erro'}
            </Text>
          )}
        </div>
      </Group>
    </UnstyledButton>
  );
}

function FailingChecksCard() {
  const alerts = useQuery({
    queryKey: [...queryKeys.alerts, 'failing-checks'],
    queryFn: () => alertsApi.list({ status: 'active', page: 1, pageSize: CHECK_SAMPLE }),
  });
  const checks = (alerts.data?.items ?? []).filter((a) => a.alertType === 'check');
  const capped = (alerts.data?.total ?? 0) > CHECK_SAMPLE;
  return (
    <Card withBorder padding="lg" component="section" aria-label="Checks com falha">
      <Group justify="space-between" wrap="nowrap" mb="sm">
        <div>
          <Text size="sm" c="dimmed" fw={500}>
            Checks com falha
          </Text>
          {alerts.isPending ? (
            <Skeleton height={32} width={60} mt={4} />
          ) : (
            <Text fz={32} fw={700} lh={1.2} data-testid="failing-checks-count">
              {alerts.isError ? 'Erro' : `${checks.length}${capped ? '+' : ''}`}
            </Text>
          )}
        </div>
        <ThemeIcon size={44} radius="md" variant="light" color="red">
          <IconChecklist size={24} aria-hidden />
        </ThemeIcon>
      </Group>
      {alerts.isSuccess && checks.length === 0 && (
        <Text size="sm" c="dimmed">
          Todos os checks estão passando.
        </Text>
      )}
      <Stack gap={6}>
        {checks.slice(0, CHECK_LIST).map((a) => {
          const info = SEVERITY_INFO[a.severity];
          return (
            <Group key={a.id} gap="xs" wrap="nowrap">
              <info.icon size={16} color={`var(--mantine-color-${info.color}-6)`} aria-label={info.label} role="img" style={{ flexShrink: 0 }} />
              <AlertTarget alert={a} agentTab="checks" />
              <Text size="sm" c="dimmed" truncate>
                {a.message}
              </Text>
            </Group>
          );
        })}
      </Stack>
    </Card>
  );
}

export function AlertStats() {
  return (
    <SimpleGrid cols={{ base: 1, md: 2 }} mb="xl">
      <Card withBorder padding="lg" component="section" aria-label="Alertas ativos por severidade">
        <Group justify="space-between" mb="md">
          <Text size="sm" c="dimmed" fw={500}>
            Alertas ativos por severidade
          </Text>
          <Anchor component={Link} to={PATHS.alerts} size="sm">
            Ver todos
          </Anchor>
        </Group>
        <SimpleGrid cols={3}>
          {[...SEVERITIES].reverse().map((s) => (
            <SeverityCount key={s} severity={s} />
          ))}
        </SimpleGrid>
      </Card>
      <FailingChecksCard />
    </SimpleGrid>
  );
}
