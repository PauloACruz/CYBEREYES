import { Alert, Badge, Button, Group, Paper, SimpleGrid, Skeleton, Text, Title } from '@mantine/core';
import { IconAlertTriangle, IconRefresh } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { meshApi } from '../../api/mesh';
import { queryKeys } from '../../api/queryKeys';
import type { MeshStatusDto } from '../../api/types';
import { LoadError } from '../../components/TableStates';
import { notifySuccess } from '../../lib/feedback';
import { formatDateTime } from '../../lib/format';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text size="sm" component="div" mt={2} style={{ wordBreak: 'break-all' }}>
        {children}
      </Text>
    </div>
  );
}

export function MeshSection() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: queryKeys.meshStatus, queryFn: meshApi.status });

  const sync = useMutation({
    mutationFn: meshApi.sync,
    onSuccess: (result) => {
      queryClient.setQueryData<MeshStatusDto>(queryKeys.meshStatus, (prev) => (prev ? { ...prev, ...result } : prev));
      void queryClient.invalidateQueries({ queryKey: queryKeys.meshStatus });
      if (!result.lastError) notifySuccess('Sincronização com o MeshCentral concluída.');
    },
  });

  const data = status.data;

  return (
    <section aria-labelledby="mesh-title">
      <Group justify="space-between" mb="xs" align="flex-end">
        <div>
          <Title order={3} id="mesh-title">
            Acesso remoto (MeshCentral)
          </Title>
          <Text size="sm" c="dimmed">
            Usuários com a permissão de acesso remoto são sincronizados automaticamente a cada 4 minutos.
          </Text>
        </div>
        <Button leftSection={<IconRefresh size={16} />} loading={sync.isPending} disabled={!data?.enabled} onClick={() => sync.mutate()}>
          Sincronizar agora
        </Button>
      </Group>
      {status.isError && <LoadError error={status.error} onRetry={() => void status.refetch()} />}
      {status.isPending && <Skeleton height={120} />}
      {data && (
        <Paper withBorder p="lg">
          {data.lastError && (
            <Alert color="red" variant="light" icon={<IconAlertTriangle size={18} />} title="Último erro de sincronização" mb="md">
              {data.lastError}
            </Alert>
          )}
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
            <Field label="Situação">
              {data.enabled ? (
                <Badge color="teal" variant="light">
                  Habilitado
                </Badge>
              ) : (
                <Badge color="gray" variant="light">
                  Não configurado
                </Badge>
              )}
            </Field>
            <Field label="Endereço">{data.url || 'Não informado'}</Field>
            <Field label="Grupo de dispositivos">{data.deviceGroup || 'Não informado'}</Field>
            <Field label="Usuários sincronizados">{data.users}</Field>
            <Field label="Última sincronização">{formatDateTime(data.lastSync)}</Field>
          </SimpleGrid>
        </Paper>
      )}
    </section>
  );
}
