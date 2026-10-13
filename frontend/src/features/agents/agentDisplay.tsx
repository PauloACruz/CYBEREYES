import { Badge, Box, Group, Progress, Text, Tooltip } from '@mantine/core';
import type { AgentStatus, HealthGrade } from '../../api/types';
import { HEALTH_GRADE_INFO } from '../care/careFormat';
import { formatDateTime, formatRelative } from '../../lib/format';
import { platformInfo, STATUS_INFO } from './agentFormat';

export function AgentStatusBadge({ status, size = 'sm' }: { status: AgentStatus; size?: 'sm' | 'md' | 'lg' }) {
  const info = STATUS_INFO[status];
  return (
    <Badge color={info.color} variant="light" size={size} leftSection={<info.icon size={12} aria-hidden />}>
      {info.label}
    </Badge>
  );
}

export function OperatingSystem({ plat, operatingSystem }: { plat: string; operatingSystem: string | null }) {
  const info = platformInfo(plat);
  return (
    <Group gap={6} wrap="nowrap">
      <info.icon size={16} aria-label={info.label} role="img" style={{ flexShrink: 0 }} />
      <Text size="sm" lineClamp={1}>
        {operatingSystem || info.label}
      </Text>
    </Group>
  );
}

/** So o icone do sistema, com o nome completo na dica e no rotulo acessivel (lista de agentes). */
export function OperatingSystemIcon({ plat, operatingSystem }: { plat: string; operatingSystem: string | null }) {
  const info = platformInfo(plat);
  const name = operatingSystem || info.label;
  return (
    <Tooltip label={name} withArrow>
      <Box component="span" display="inline-flex" role="img" aria-label={name} c="dimmed">
        <info.icon size={18} aria-hidden style={{ flexShrink: 0 }} />
      </Box>
    </Tooltip>
  );
}

/** Nota de saude da lista: numero, barra e classificacao com a cor do Health Check. */
export function HealthScore({ score, grade }: { score: number | null; grade: HealthGrade | null }) {
  if (score === null || grade === null) {
    return (
      <Text size="sm" c="dimmed" title="O Health Check ainda não rodou nesta máquina">
        Sem nota
      </Text>
    );
  }
  const info = HEALTH_GRADE_INFO[grade];
  return (
    <Tooltip label={`Nota ${score} de 100: ${info.label}`} withArrow>
      <Group gap={8} wrap="nowrap">
        <Text size="sm" fw={700} c={info.color} w={24} ta="right">
          {score}
        </Text>
        <Progress value={score} color={info.color} size={6} w={48} aria-hidden />
        <Text size="xs" c={info.color}>
          {info.label}
        </Text>
      </Group>
    </Tooltip>
  );
}

export function RelativeTime({ value }: { value: string | null }) {
  if (!value) {
    return (
      <Text size="sm" c="dimmed" span>
        Nunca
      </Text>
    );
  }
  return (
    <Tooltip label={formatDateTime(value)} withArrow>
      <Text size="sm" span component="time" dateTime={value}>
        {formatRelative(value)}
      </Text>
    </Tooltip>
  );
}
