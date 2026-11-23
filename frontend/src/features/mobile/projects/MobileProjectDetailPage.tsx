import { useState, type ReactNode } from 'react';
import { Anchor, Box, Center, Checkbox, Chip, Group, Loader, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconChevronRight, IconDeviceDesktop } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { ApiError } from '../../../api/client';
import { projectsApi, type ProjectAgent, type ProjectDetail, type ProjectTask } from '../../../api/projects';
import { queryKeys } from '../../../api/queryKeys';
import { MOBILE_PATHS, projectPath } from '../../../app/paths';
import { useMe } from '../../../auth/useMe';
import { NotFound } from '../../../components/NotFound';
import { LoadError } from '../../../components/TableStates';
import { formatDateTime } from '../../../lib/format';
import { ItemStatusBadge, PhaseBadge, ProgressSummary } from '../../projects/ProjectBadges';
import { refreshProject } from '../../projects/projectActions';
import { formatDay, isFinished, periodLabel, recurrenceLabel } from '../../projects/projectFormat';
import { ProjectJournal } from '../../projects/ProjectJournal';
import { ProgressModal, type ProgressTarget } from '../../projects/ProgressModal';
import { CONSOLE_STATE } from '../mobileMode';
import { InfoRows, MobileHeader, MobilePage, MobileSection } from '../MobilePage';
import { MOBILE_CARD } from '../mobileStyles';

export function MobileProjectDetailPage() {
  const { id: rawId } = useParams();
  const id = Number(rawId);
  const valid = Number.isInteger(id) && id > 0;
  const project = useQuery({ queryKey: queryKeys.project(id), queryFn: () => projectsApi.get(id), enabled: valid });
  const header = (
    <MobileHeader title={project.data?.name ?? 'Projeto'} back={{ to: MOBILE_PATHS.projects, label: 'Projetos' }} />
  );

  if (!valid || (project.error instanceof ApiError && project.error.status === 404)) {
    return (
      <MobilePage header={header}>
        <NotFound />
      </MobilePage>
    );
  }
  if (project.isError) {
    return (
      <MobilePage header={header}>
        <LoadError error={project.error} onRetry={() => void project.refetch()} />
      </MobilePage>
    );
  }
  if (!project.data) {
    return (
      <MobilePage header={header}>
        <Center py="xl">
          <Loader aria-label="Carregando projeto" />
        </Center>
      </MobilePage>
    );
  }
  return <ProjectView project={project.data} header={header} />;
}

const ROW_BORDER = { borderTop: '1px solid var(--ce-border-subtle)' } as const;

function TaskRow({ project, task, mine, first, onRecord }: { project: ProjectDetail; task: ProjectTask; mine: boolean; first: boolean; onRecord: () => void }) {
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: (done: boolean) => projectsApi.progress(project.id, { taskIds: [task.id], status: done ? 'done' : 'pending' }),
    onSuccess: () => refreshProject(queryClient, project.id),
  });
  return (
    <Group gap={12} wrap="nowrap" px={16} py={10} mih={56} style={first ? undefined : ROW_BORDER}>
      <Checkbox
        size="md"
        aria-label={`Concluir ${task.title}`}
        checked={task.status === 'done'}
        disabled={!task.canUpdate || toggle.isPending}
        onChange={(e) => toggle.mutate(e.currentTarget.checked)}
      />
      <UnstyledButton onClick={onRecord} disabled={!task.canUpdate} style={{ flex: 1, minWidth: 0 }} aria-label={`Registrar andamento de ${task.title}`}>
        <Text size="md" fw={500} td={isFinished(task.status) ? 'line-through' : undefined}>
          {task.title}
        </Text>
        <Text size="sm" c={task.overdue ? 'red' : 'var(--ce-text-secondary)'}>
          {[mine ? 'Você' : (task.assignee?.name ?? 'Sem responsável'), task.dueDate ? `prazo ${formatDay(task.dueDate)}` : null]
            .filter(Boolean)
            .join(' · ')}
          {task.overdue && ' (atrasada)'}
        </Text>
        {task.status !== 'pending' && task.status !== 'done' && <ItemStatusBadge status={task.status} />}
      </UnstyledButton>
    </Group>
  );
}

function StationRow({ row, first, onRecord, disabled }: { row: ProjectAgent; first: boolean; onRecord: () => void; disabled: boolean }) {
  return (
    <UnstyledButton
      onClick={onRecord}
      disabled={disabled}
      display="block"
      w="100%"
      px={16}
      py={10}
      style={first ? undefined : ROW_BORDER}
      aria-label={`Registrar andamento de ${row.hostname}`}
    >
      <Group gap={12} wrap="nowrap">
        <IconDeviceDesktop size={20} color="var(--ce-text-secondary)" aria-hidden />
        <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
          <Text ff="monospace" fw={500} truncate>
            {row.hostname}
          </Text>
          <Text size="sm" c="var(--ce-text-secondary)" truncate>
            {[row.siteName ?? row.clientName, row.description].filter(Boolean).join(' · ') || '—'}
          </Text>
          {row.note && (
            <Text size="sm" c="var(--ce-text-secondary)" fs="italic" lineClamp={2}>
              “{row.note}”
            </Text>
          )}
          {row.doneAt && (
            <Text size="xs" c="var(--ce-text-tertiary)">
              {row.doneByName}, {formatDateTime(row.doneAt)}
            </Text>
          )}
        </Stack>
        <ItemStatusBadge status={row.status} />
        {!disabled && <IconChevronRight size={18} color="var(--ce-text-tertiary)" aria-hidden />}
      </Group>
    </UnstyledButton>
  );
}

function ProjectView({ project, header }: { project: ProjectDetail; header: ReactNode }) {
  const { data: me } = useMe();
  const [target, setTarget] = useState<ProgressTarget | null>(null);
  const [onlyOpen, setOnlyOpen] = useState(true);
  const mine = (t: ProjectTask) => t.assignee?.id === me?.id;
  const tasks = [...project.tasks].sort((a, b) => Number(mine(b)) - Number(mine(a)));
  const stations = onlyOpen ? project.agents.filter((a) => !isFinished(a.status)) : project.agents;

  return (
    <MobilePage header={header}>
      <InfoRows
        rows={[
          { label: 'Situação', value: <PhaseBadge phase={project.phase} /> },
          { label: 'Responsável', value: project.owner?.name ?? 'Ninguém' },
          {
            label: project.recurrence === 'none' ? 'Período' : `Ciclo ${project.cycle}`,
            value: periodLabel(project.startDate, project.dueDate),
          },
          ...(project.recurrence !== 'none' ? [{ label: 'Repetição', value: recurrenceLabel(project.recurrence, project.recurrenceInterval) }] : []),
        ]}
      />
      <Box p={16} style={MOBILE_CARD}>
        <ProgressSummary progress={project.progress} />
      </Box>
      {project.description && (
        <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
          {project.description}
        </Text>
      )}

      {project.tasks.length > 0 && (
        <MobileSection title={`Tarefas (${project.progress.tasksFinished}/${project.tasks.length})`}>
          <Box style={MOBILE_CARD}>
            {tasks.map((t, index) => (
              <TaskRow key={t.id} project={project} task={t} mine={mine(t)} first={index === 0} onRecord={() => setTarget({ kind: 'task', task: t })} />
            ))}
          </Box>
        </MobileSection>
      )}

      {project.agents.length > 0 && (
        <MobileSection
          title={`Estações (${project.progress.agentsFinished}/${project.agents.length})`}
          action={
            <Chip size="xs" checked={onlyOpen} onChange={setOnlyOpen} variant="outline">
              Só as que faltam
            </Chip>
          }
        >
          <Box style={MOBILE_CARD}>
            {stations.length === 0 ? (
              <Text size="sm" c="var(--ce-text-secondary)" px={16} py={12}>
                Todas as estações já foram feitas.
              </Text>
            ) : (
              stations.map((row, index) => (
                <StationRow
                  key={row.id}
                  row={row}
                  first={index === 0}
                  disabled={!project.can.record}
                  onRecord={() => setTarget({ kind: 'agents', rows: [row] })}
                />
              ))
            )}
          </Box>
        </MobileSection>
      )}

      <MobileSection title="Documentação">
        <ProjectJournal project={project} />
      </MobileSection>

      <Anchor component={Link} to={projectPath(project.id)} state={CONSOLE_STATE} size="sm" ta="center">
        Abrir no console
      </Anchor>
      <ProgressModal projectId={project.id} target={target} onClose={() => setTarget(null)} fullScreen />
    </MobilePage>
  );
}
