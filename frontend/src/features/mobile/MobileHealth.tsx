import { RingProgress, Stack, Text } from '@mantine/core';
import type { HealthGrade } from '../../api/types';
import { HEALTH_GRADE_INFO } from '../care/careFormat';

/** Nota de saude compacta da lista de agentes: numero grande e a classificacao abaixo. */
export function HealthNumber({ score, grade }: { score: number | null | undefined; grade: HealthGrade | null | undefined }) {
  if (score === null || score === undefined || !grade) {
    return (
      <Text size="sm" c="var(--ce-text-tertiary)" title="O Health Check ainda não rodou nesta máquina">
        Sem nota
      </Text>
    );
  }
  const info = HEALTH_GRADE_INFO[grade];
  return (
    <Stack gap={2} align="flex-end" title={`Nota ${score} de 100: ${info.label}`}>
      <Text fz={20} fw={700} lh="22px" c={info.color}>
        {score}
      </Text>
      <Text size="xs" c={info.color}>
        {info.label}
      </Text>
    </Stack>
  );
}

/** Anel com a nota de saude (detalhe do agente e Cybereyes Care). */
export function HealthRing({ score, grade, size = 96 }: { score: number; grade: HealthGrade; size?: number }) {
  const info = HEALTH_GRADE_INFO[grade];
  return (
    <RingProgress
      size={size}
      thickness={8}
      roundCaps
      sections={[{ value: score, color: info.color }]}
      rootColor="var(--ce-bg-hover)"
      aria-label={`Nota ${score} de 100: ${info.label}`}
      label={
        <Text ta="center" fz={size >= 90 ? 26 : 22} fw={700}>
          {score}
        </Text>
      }
    />
  );
}
