import { Anchor, Paper, Table, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { projectsApi } from '../../api/projects';
import { queryKeys } from '../../api/queryKeys';
import type { AgentDetail } from '../../api/types';
import { projectPath } from '../../app/paths';
import { EmptyRow, LoadError, LoadingRows } from '../../components/TableStates';
import { formatDateTime } from '../../lib/format';
import { ItemStatusBadge, PhaseBadge } from './ProjectBadges';
import { formatDay } from './projectFormat';

/** Projetos de que a estação faz parte e a situação dela no ciclo atual de cada um. */
export function AgentProjectsTab({ agent }: { agent: Pick<AgentDetail, 'id'> }) {
  const projects = useQuery({ queryKey: queryKeys.agentProjects(agent.id), queryFn: () => projectsApi.forAgent(agent.id) });
  return (
    <>
      {projects.isError && <LoadError error={projects.error} onRetry={() => void projects.refetch()} />}
      <Paper withBorder>
        <Table.ScrollContainer minWidth={640}>
          <Table verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Projeto</Table.Th>
                <Table.Th>Situação do projeto</Table.Th>
                <Table.Th>Prazo</Table.Th>
                <Table.Th>Nesta estação</Table.Th>
                <Table.Th>Registrado</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {projects.isPending && <LoadingRows columns={5} rows={3} />}
              {projects.isSuccess && projects.data.length === 0 && <EmptyRow columns={5} message="Esta estação não está em nenhum projeto." />}
              {(projects.data ?? []).map((p) => (
                <Table.Tr key={p.id}>
                  <Table.Td>
                    <Anchor component={Link} to={`${projectPath(p.id)}?aba=estacoes`} size="sm" fw={500}>
                      {p.name}
                    </Anchor>
                    {p.cycle > 1 && (
                      <Text size="xs" c="dimmed">
                        Ciclo {p.cycle}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <PhaseBadge phase={p.phase} />
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{formatDay(p.dueDate)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <ItemStatusBadge status={p.itemStatus} />
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {p.doneAt ? `${p.doneByName ?? ''}, ${formatDateTime(p.doneAt)}` : '—'}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
    </>
  );
}
