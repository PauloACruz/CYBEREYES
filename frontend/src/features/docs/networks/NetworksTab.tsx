import { useState } from 'react';
import { ActionIcon, Anchor, Button, Group, Paper, Progress, Table, Text, Tooltip } from '@mantine/core';
import { IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { networksApi } from '../../../api/docs';
import { queryKeys } from '../../../api/queryKeys';
import type { NetworkDto } from '../../../api/types';
import { networkPath } from '../../../app/paths';
import { EmptyRow, LoadError, LoadingRows } from '../../../components/TableStates';
import { confirmAction, notifySuccess } from '../../../lib/feedback';
import { NetworkFormModal } from './NetworkFormModal';

const COLUMNS = 7;

type Editing = { mode: 'new' } | { mode: 'edit'; network: NetworkDto } | null;

function usageColor(percent: number): string {
  if (percent >= 90) return 'red';
  if (percent >= 75) return 'orange';
  return 'teal';
}

export function NetworksTab({ clientId, canManage }: { clientId: number | undefined; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Editing>(null);
  const networks = useQuery({ queryKey: queryKeys.networkList(clientId), queryFn: () => networksApi.list(clientId) });

  const remove = useMutation({
    mutationFn: (id: number) => networksApi.remove(id),
    onSuccess: () => {
      notifySuccess('Rede excluída.');
      void queryClient.invalidateQueries({ queryKey: queryKeys.networks });
    },
  });

  return (
    <>
      {canManage && (
        <Group justify="flex-end" mb="sm">
          <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing({ mode: 'new' })}>
            Nova rede
          </Button>
        </Group>
      )}
      {networks.isError && <LoadError error={networks.error} onRetry={() => void networks.refetch()} />}
      <Paper withBorder>
        <Table.ScrollContainer minWidth={900}>
          <Table verticalSpacing="xs" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Nome</Table.Th>
                <Table.Th w={180}>CIDR</Table.Th>
                <Table.Th w={140}>VLAN</Table.Th>
                <Table.Th w={140}>Gateway</Table.Th>
                <Table.Th w={180}>Cliente / site</Table.Th>
                <Table.Th w={170}>Uso</Table.Th>
                <Table.Th w={80} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {networks.isPending && <LoadingRows columns={COLUMNS} />}
              {networks.data && networks.data.length === 0 && <EmptyRow columns={COLUMNS} message="Nenhuma rede documentada." />}
              {networks.data?.map((network) => {
                const percent = network.totalHosts > 0 ? (network.usedCount / network.totalHosts) * 100 : 0;
                return (
                  <Table.Tr key={network.id}>
                    <Table.Td>
                      <Anchor component={Link} to={networkPath(network.id)} size="sm" fw={600}>
                        {network.name}
                      </Anchor>
                      {network.description && (
                        <Text size="xs" c="dimmed" lineClamp={1}>
                          {network.description}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" ff="monospace">
                        {network.cidr}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">
                        {network.vlanId ? `${network.vlanId}${network.vlanName ? ` (${network.vlanName})` : ''}` : 'Sem VLAN'}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" ff="monospace">
                        {network.gateway ?? ''}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">
                        {network.clientName}
                        {network.siteName ? ` / ${network.siteName}` : ''}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Group gap="xs" wrap="nowrap">
                        <Progress value={percent} color={usageColor(percent)} w={80} aria-label={`Uso de ${network.name}`} />
                        <Text size="xs" c="dimmed">
                          {network.usedCount} de {network.totalHosts}
                        </Text>
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      {canManage && (
                        <Group gap={4} wrap="nowrap" justify="flex-end">
                          <Tooltip label="Editar">
                            <ActionIcon variant="subtle" color="gray" aria-label={`Editar ${network.name}`} onClick={() => setEditing({ mode: 'edit', network })}>
                              <IconPencil size={16} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label="Excluir">
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              aria-label={`Excluir ${network.name}`}
                              onClick={() =>
                                confirmAction({
                                  title: 'Excluir rede',
                                  message: `Excluir ${network.name} (${network.cidr}) e todos os registros de IP?`,
                                  confirmLabel: 'Excluir',
                                  danger: true,
                                  onConfirm: () => remove.mutate(network.id),
                                })
                              }
                            >
                              <IconTrash size={16} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      )}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
      {canManage && (
        <NetworkFormModal
          opened={editing !== null}
          onClose={() => setEditing(null)}
          network={editing?.mode === 'edit' ? editing.network : undefined}
          defaultClientId={clientId}
        />
      )}
    </>
  );
}
