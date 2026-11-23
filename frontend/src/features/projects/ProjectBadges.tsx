import { Badge, Box, Group, Progress, Stack, Text } from '@mantine/core';
import type { ProjectItemStatus, ProjectPhase, ProjectProgress } from '../../api/projects';
import { ITEM_STATUS_COLORS, ITEM_STATUS_LABELS, PHASE_COLORS, PHASE_LABELS, progressPercent } from './projectFormat';

export function PhaseBadge({ phase }: { phase: ProjectPhase }) {
  return (
    <Badge variant="light" color={PHASE_COLORS[phase]}>
      {PHASE_LABELS[phase]}
    </Badge>
  );
}

export function ItemStatusBadge({ status }: { status: ProjectItemStatus }) {
  return (
    <Group gap={6} wrap="nowrap">
      <Box w={8} h={8} style={{ borderRadius: 4, flexShrink: 0 }} bg={`var(--mantine-color-${ITEM_STATUS_COLORS[status]}-6)`} aria-hidden />
      <Text size="sm">{ITEM_STATUS_LABELS[status]}</Text>
    </Group>
  );
}

/** Barra de progresso com o que já foi feito: estações e tarefas encerradas sobre o total. */
export function ProgressSummary({ progress, compact = false }: { progress: ProjectProgress; compact?: boolean }) {
  const total = progress.agentsTotal + progress.tasksTotal;
  if (total === 0) {
    return (
      <Text size="sm" c="dimmed">
        Nada a fazer ainda
      </Text>
    );
  }
  const percent = progressPercent(progress);
  const parts: string[] = [];
  if (progress.agentsTotal > 0) parts.push(`${progress.agentsFinished}/${progress.agentsTotal} estações`);
  if (progress.tasksTotal > 0) parts.push(`${progress.tasksFinished}/${progress.tasksTotal} tarefas`);
  return (
    <Stack gap={4} miw={compact ? 140 : undefined}>
      <Progress value={percent} color={percent === 100 ? 'teal' : 'blue'} size="sm" aria-label={`Progresso ${percent}%`} />
      <Group gap={6} wrap="wrap">
        <Text size="xs" c="dimmed">
          {percent}% · {parts.join(' · ')}
        </Text>
        {progress.problems > 0 && (
          <Badge size="xs" color="red" variant="light">
            {progress.problems} com problema
          </Badge>
        )}
        {progress.overdueTasks > 0 && (
          <Badge size="xs" color="orange" variant="light">
            {progress.overdueTasks} {progress.overdueTasks === 1 ? 'tarefa atrasada' : 'tarefas atrasadas'}
          </Badge>
        )}
      </Group>
    </Stack>
  );
}
