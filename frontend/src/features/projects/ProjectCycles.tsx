import { Accordion, Badge, Group, Stack, Table, Text } from '@mantine/core';
import { IconCheckbox, IconDeviceDesktop } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { projectsApi, type ProjectCycle, type ProjectDetail } from '../../api/projects';
import { queryKeys } from '../../api/queryKeys';
import { LoadError } from '../../components/TableStates';
import { formatDateTime } from '../../lib/format';
import { ItemStatusBadge } from './ProjectBadges';
import { isFinished, periodLabel } from './projectFormat';

function CycleTotals({ cycle }: { cycle: ProjectCycle }) {
  const finished = cycle.items.filter((i) => isFinished(i.status)).length;
  const problems = cycle.items.filter((i) => i.status === 'problem').length;
  const open = cycle.items.length - finished - problems;
  return (
    <Group gap={6}>
      <Badge size="sm" variant="light" color="teal">
        {finished}/{cycle.items.length} encerrados
      </Badge>
      {problems > 0 && (
        <Badge size="sm" variant="light" color="red">
          {problems} com problema
        </Badge>
      )}
      {open > 0 && (
        <Badge size="sm" variant="light" color="gray">
          {open} sem concluir
        </Badge>
      )}
    </Group>
  );
}

/** Histórico dos ciclos concluídos, com o resultado de cada estação e tarefa. */
export function ProjectCycles({ project }: { project: ProjectDetail }) {
  const cycles = useQuery({ queryKey: queryKeys.projectCycles(project.id), queryFn: () => projectsApi.cycles(project.id) });
  if (cycles.isError) return <LoadError error={cycles.error} onRetry={() => void cycles.refetch()} />;
  if (cycles.isSuccess && cycles.data.length === 0) {
    return (
      <Text size="sm" c="dimmed" ta="center" py="lg">
        Nenhum ciclo concluído ainda.
      </Text>
    );
  }
  return (
    <Accordion variant="separated" multiple>
      {(cycles.data ?? []).map((c) => (
        <Accordion.Item key={c.id} value={String(c.id)}>
          <Accordion.Control>
            <Group justify="space-between" wrap="wrap" pr="sm">
              <Stack gap={0}>
                <Text fw={600}>Ciclo {c.number}</Text>
                <Text size="xs" c="dimmed">
                  {periodLabel(c.startDate, c.dueDate)} · concluído em {formatDateTime(c.closedAt)} por {c.closedByName}
                </Text>
              </Stack>
              <CycleTotals cycle={c} />
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            {c.summary && (
              <Text size="sm" mb="sm" style={{ whiteSpace: 'pre-wrap' }}>
                {c.summary}
              </Text>
            )}
            <Table.ScrollContainer minWidth={640}>
              <Table verticalSpacing={4}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Item</Table.Th>
                    <Table.Th>Detalhe</Table.Th>
                    <Table.Th>Situação</Table.Th>
                    <Table.Th>Observação</Table.Th>
                    <Table.Th>Registrado</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {c.items.map((item, index) => (
                    <Table.Tr key={index}>
                      <Table.Td>
                        <Group gap={6} wrap="nowrap">
                          {item.kind === 'agent' ? <IconDeviceDesktop size={14} aria-label="Estação" /> : <IconCheckbox size={14} aria-label="Tarefa" />}
                          <Text size="sm" fw={500}>
                            {item.title}
                          </Text>
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{item.detail || '—'}</Text>
                      </Table.Td>
                      <Table.Td>
                        <ItemStatusBadge status={item.status} />
                      </Table.Td>
                      <Table.Td maw={280}>
                        <Text size="sm" lineClamp={2} title={item.note ?? undefined}>
                          {item.note ?? '—'}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" c="dimmed">
                          {item.doneAt ? `${item.doneByName ?? ''}, ${formatDateTime(item.doneAt)}` : '—'}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Accordion.Panel>
        </Accordion.Item>
      ))}
    </Accordion>
  );
}
