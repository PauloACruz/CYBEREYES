import { Badge, Box, Chip, Group, Progress, Skeleton, Stack, Text } from '@mantine/core';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { projectsApi, type ListProjectsParams, type ProjectSummary } from '../../../api/projects';
import { queryKeys } from '../../../api/queryKeys';
import { mobileProjectPath } from '../../../app/paths';
import { LoadError } from '../../../components/TableStates';
import { PhaseBadge } from '../../projects/ProjectBadges';
import { periodLabel, progressPercent, recurrenceLabel } from '../../projects/projectFormat';
import { MobileHeader, MobilePage } from '../MobilePage';
import { MOBILE_CARD } from '../mobileStyles';

type Filter = 'meus' | 'todos' | 'atrasados';
const FILTERS: Filter[] = ['meus', 'todos', 'atrasados'];
const LABELS: Record<Filter, string> = { meus: 'Meus', todos: 'Todos abertos', atrasados: 'Atrasados' };

function isFilter(value: string | null): value is Filter {
  return FILTERS.includes(value as Filter);
}

function ProjectCard({ project }: { project: ProjectSummary }) {
  const percent = progressPercent(project.progress);
  const total = project.progress.agentsTotal + project.progress.tasksTotal;
  return (
    <Box
      component={Link}
      to={mobileProjectPath(project.id)}
      aria-label={`Projeto ${project.name}`}
      p="14px 16px"
      style={{ ...MOBILE_CARD, display: 'flex', flexDirection: 'column', gap: 8, textDecoration: 'none', color: 'inherit' }}
    >
      <Group gap={8} wrap="nowrap" align="flex-start">
        <Text fw={600} size="md" lh="22px" style={{ flex: 1, minWidth: 0 }}>
          {project.name}
        </Text>
        <PhaseBadge phase={project.phase} />
      </Group>
      <Text size="sm" c="var(--ce-text-secondary)">
        {[project.clients.map((c) => c.name).join(', ') || 'Interno', periodLabel(project.startDate, project.dueDate)].join(' · ')}
      </Text>
      {total > 0 && <Progress value={percent} size="sm" color={percent === 100 ? 'teal' : 'blue'} aria-label={`Progresso ${percent}%`} />}
      <Group gap={8} wrap="wrap">
        <Text size="sm" c="var(--ce-text-secondary)">
          {total > 0 ? `${percent}% feito` : 'Nada a fazer ainda'}
          {project.recurrence !== 'none' && ` · ${recurrenceLabel(project.recurrence, project.recurrenceInterval).toLowerCase()}`}
        </Text>
        {project.myOpenTasks > 0 && (
          <Badge size="sm" variant="light" color="violet">
            {project.myOpenTasks === 1 ? '1 tarefa sua' : `${project.myOpenTasks} tarefas suas`}
          </Badge>
        )}
        {project.progress.problems > 0 && (
          <Badge size="sm" variant="light" color="red">
            {project.progress.problems} com problema
          </Badge>
        )}
      </Group>
    </Box>
  );
}

/** Projetos abertos, começando pelos do técnico (responsável pelo projeto ou por alguma tarefa). */
export function MobileProjectsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filterParam = searchParams.get('filtro');
  const filter: Filter = isFilter(filterParam) ? filterParam : 'meus';
  const params: ListProjectsParams = { status: 'open', mine: filter === 'meus' || undefined };
  const projects = useQuery({
    queryKey: queryKeys.projectList(params),
    queryFn: () => projectsApi.list(params),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const all = projects.data ?? [];
  const items = filter === 'atrasados' ? all.filter((p) => p.phase === 'late' || p.progress.overdueTasks > 0) : all;

  return (
    <MobilePage header={<MobileHeader title="Projetos" />}>
      <Chip.Group
        value={filter}
        onChange={(v) =>
          setSearchParams(
            (prev) => {
              const next = new URLSearchParams(prev);
              if (v === 'meus') next.delete('filtro');
              else next.set('filtro', v);
              return next;
            },
            { replace: true },
          )
        }
      >
        <Group gap={8} wrap="nowrap" mx={-16} px={16} pb={2} role="group" aria-label="Filtrar projetos" style={{ overflowX: 'auto', scrollbarWidth: 'none' }}>
          {FILTERS.map((f) => (
            <Chip key={f} value={f} variant="outline" size="md" styles={{ label: { whiteSpace: 'nowrap' } }}>
              {LABELS[f]}
            </Chip>
          ))}
        </Group>
      </Chip.Group>
      {projects.isError && <LoadError error={projects.error} onRetry={() => void projects.refetch()} />}
      {projects.isPending && (
        <Stack gap={10}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} h={120} radius={8} />
          ))}
        </Stack>
      )}
      {projects.isSuccess && items.length === 0 && (
        <Text c="var(--ce-text-secondary)" ta="center" py="xl">
          {filter === 'meus' ? 'Nenhum projeto aberto com você.' : 'Nenhum projeto aqui.'}
        </Text>
      )}
      <Stack gap={10}>
        {items.map((p) => (
          <ProjectCard key={p.id} project={p} />
        ))}
      </Stack>
    </MobilePage>
  );
}
