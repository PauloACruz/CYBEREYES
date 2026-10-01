import { Anchor, Badge, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { IconShieldCheck } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { policiesApi } from '../../../api/monitoring';
import { queryKeys } from '../../../api/queryKeys';
import type { PolicySource } from '../../../api/types';
import { policyPath } from '../../../app/paths';
import { LoadError } from '../../../components/TableStates';

const SOURCE_LABEL: Record<PolicySource, string> = {
  agente: 'Do agente',
  site: 'Do site',
  cliente: 'Do cliente',
  global: 'Global',
};

/** Politicas que valem para o agente, da mais especifica para a mais geral. */
export function EffectivePolicies({ agentId }: { agentId: number }) {
  const policies = useQuery({ queryKey: queryKeys.agentPolicies(agentId), queryFn: () => policiesApi.forAgent(agentId) });
  return (
    <Paper withBorder p="lg" mt="md" component="section" aria-labelledby="politicas-efetivas">
      <Group gap="xs" mb="sm">
        <IconShieldCheck size={18} aria-hidden />
        <Title order={4} id="politicas-efetivas">
          Políticas efetivas
        </Title>
      </Group>
      {policies.isError && <LoadError error={policies.error} onRetry={() => void policies.refetch()} />}
      {policies.isPending && (
        <Text size="sm" c="dimmed">
          Carregando políticas...
        </Text>
      )}
      {policies.isSuccess && policies.data.length === 0 && (
        <Text size="sm" c="dimmed">
          Nenhuma política se aplica a este agente.
        </Text>
      )}
      <Stack gap="xs">
        {policies.data?.map((p) => (
          <Group key={`${p.source}-${p.policyId}`} gap="sm">
            <Badge variant="light" color="gray" w={100}>
              {SOURCE_LABEL[p.source]}
            </Badge>
            <Anchor component={Link} to={policyPath(p.policyId)} size="sm">
              {p.name}
            </Anchor>
          </Group>
        ))}
      </Stack>
    </Paper>
  );
}
