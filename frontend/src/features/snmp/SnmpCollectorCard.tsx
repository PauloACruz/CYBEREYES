import { useState } from 'react';
import { Alert, Paper, Stack, Switch, Text } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import { snmpApi } from '../../api/snmp';
import { PERMISSIONS, type AgentDetail } from '../../api/types';
import { hasPermission } from '../../auth/permissions';
import { useMe } from '../../auth/useMe';
import { notifySuccess } from '../../lib/feedback';
import { MIN_COLLECTOR_VERSION, versionAtLeast } from './snmpFormat';

/** Chave "Coletor SNMP" no detalhe do agente (agents.manage). */
export function SnmpCollectorCard({ agent }: { agent: AgentDetail }) {
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const canManage = hasPermission(me, PERMISSIONS.agentsManage);
  const canViewSnmp = hasPermission(me, PERMISSIONS.snmpView);
  const collectors = useQuery({
    queryKey: queryKeys.snmpCollectors,
    queryFn: () => snmpApi.collectors({ silent: true }),
    enabled: canManage && canViewSnmp && agent.snmpCollector === undefined,
  });
  const [override, setOverride] = useState<boolean | null>(null);
  const known = agent.snmpCollector ?? collectors.data?.some((c) => c.agentId === agent.id) ?? false;
  const enabled = override ?? known;
  const supported = versionAtLeast(agent.version, MIN_COLLECTOR_VERSION);

  const save = useMutation({
    mutationFn: (next: boolean) => snmpApi.setCollector(agent.id, next),
    onMutate: (next) => setOverride(next),
    onSuccess: (_, next) => {
      notifySuccess(next ? `${agent.hostname} agora é coletor SNMP.` : `${agent.hostname} deixou de ser coletor SNMP.`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.snmpCollectors });
      void queryClient.invalidateQueries({ queryKey: queryKeys.agentDetail(agent.id) });
    },
    onError: () => setOverride(null),
  });

  if (!canManage) return null;

  return (
    <Paper withBorder p="lg" mt="md" component="section" aria-label="Coletor SNMP">
      <Stack gap="sm">
        <Switch
            label="Coletor SNMP"
            description="O agente consulta os dispositivos SNMP do cliente e recebe traps na porta UDP 162."
            checked={enabled}
            disabled={(!supported && !enabled) || save.isPending || (collectors.isPending && collectors.fetchStatus !== 'idle')}
          onChange={(e) => save.mutate(e.currentTarget.checked)}
        />
        {!supported && (
          <Alert color="orange" variant="light" icon={<IconInfoCircle size={18} />}>
            <Text size="sm">
              Exige agente {MIN_COLLECTOR_VERSION} ou superior. Versão instalada: {agent.version || 'não informada'}.
            </Text>
          </Alert>
        )}
      </Stack>
    </Paper>
  );
}
