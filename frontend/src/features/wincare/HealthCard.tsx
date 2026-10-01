import { Badge, Button, Group, Skeleton, Stack, Table, Text } from '@mantine/core';
import { IconHeartbeat, IconRefresh } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../api/client';
import { queryKeys } from '../../api/queryKeys';
import type { HealthReport } from '../../api/types';
import { wincareApi } from '../../api/wincare';
import { LoadError } from '../../components/TableStates';
import { formatDateTime } from '../../lib/format';
import { SheetCard } from '../inventory/sheetDisplay';
import { HEALTH_GRADE_INFO, HEALTH_ITEM_INFO } from './wincareFormat';

function HealthScore({ report }: { report: HealthReport }) {
  const grade = HEALTH_GRADE_INFO[report.grade];
  return (
    <Group gap="md" align="center" wrap="nowrap">
      <Text fz={44} fw={700} lh={1} c={`${grade.color}.7`} aria-label={`Nota ${report.score} de 100`}>
        {report.score}
      </Text>
      <Stack gap={4}>
        <Badge color={grade.color} variant="filled" size="lg">
          {grade.label}
        </Badge>
        <Text size="xs" c="dimmed">
          Coletado em {formatDateTime(report.collectedAt)}
        </Text>
      </Stack>
    </Group>
  );
}

function HealthItems({ report }: { report: HealthReport }) {
  return (
    <Table.ScrollContainer minWidth={420}>
      <Table verticalSpacing={6} aria-label="Itens da verificação de saúde">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Item</Table.Th>
            <Table.Th w={120}>Situação</Table.Th>
            <Table.Th>Valor</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {report.items.map((item) => {
            const info = HEALTH_ITEM_INFO[item.status];
            const unknown = item.status === 'unknown';
            return (
              <Table.Tr key={item.key} c={unknown ? 'dimmed' : undefined}>
                <Table.Td>
                  <Text size="sm" fw={500} c={unknown ? 'dimmed' : undefined}>
                    {item.label}
                  </Text>
                  {item.detail && (
                    <Text size="xs" c="dimmed">
                      {item.detail}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  <Badge color={info.color} variant="light" size="sm">
                    {info.label}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" c={unknown ? 'dimmed' : undefined}>
                    {item.value}
                  </Text>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

/** Card "Saúde": ultimo Health Check guardado do agente e coleta sob demanda. */
export function HealthCard({ agentId }: { agentId: number }) {
  const queryClient = useQueryClient();
  const health = useQuery({
    queryKey: queryKeys.agentHealth(agentId),
    queryFn: () => wincareApi.health(agentId, { silent: true }),
  });
  const notCollected = health.error instanceof ApiError && health.error.status === 404;

  const collect = useMutation({
    mutationFn: () => wincareApi.collectHealth(agentId),
    onSuccess: (report) => queryClient.setQueryData(queryKeys.agentHealth(agentId), report),
  });

  return (
    <SheetCard
      id={`saude-${agentId}-title`}
      title="Saúde"
      icon={IconHeartbeat}
      actions={
        <Button size="xs" variant="light" leftSection={<IconRefresh size={14} />} loading={collect.isPending} onClick={() => collect.mutate()}>
          Coletar agora
        </Button>
      }
    >
      {health.isPending && <Skeleton height={80} />}
      {notCollected && (
        <Text size="sm" c="dimmed">
          Ainda não coletado.
        </Text>
      )}
      {health.isError && !notCollected && <LoadError error={health.error} onRetry={() => void health.refetch()} />}
      {health.data && (
        <Stack gap="md">
          <HealthScore report={health.data} />
          <HealthItems report={health.data} />
        </Stack>
      )}
    </SheetCard>
  );
}
