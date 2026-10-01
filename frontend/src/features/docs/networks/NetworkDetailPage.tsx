import { useState } from 'react';
import { ActionIcon, Anchor, Badge, Breadcrumbs, Button, Center, Group, Loader, Paper, Progress, SimpleGrid, Stack, Table, Text, Title, Tooltip } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconPencil, IconPlus, IconRadar, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { ApiError } from '../../../api/client';
import { networksApi } from '../../../api/docs';
import { queryKeys } from '../../../api/queryKeys';
import { PERMISSIONS, type IpRecordDto, type NetworkDetail } from '../../../api/types';
import { assetPath, docsTabPath } from '../../../app/paths';
import { hasPermission } from '../../../auth/permissions';
import { useMe } from '../../../auth/useMe';
import { NotFound } from '../../../components/NotFound';
import { EmptyRow, LoadError } from '../../../components/TableStates';
import { confirmAction, notifySuccess } from '../../../lib/feedback';
import { compareIp } from '../../../lib/network';
import { IpKindBadge } from '../../inventory/AssetBadges';
import { Field, Missing } from '../../inventory/sheetDisplay';
import { IpRecordFormModal, type IpPrefill } from './IpRecordFormModal';
import { NetworkFormModal } from './NetworkFormModal';

export function NetworkDetailPage() {
  const { id: rawId } = useParams();
  const id = Number(rawId);
  const valid = Number.isInteger(id) && id > 0;
  const network = useQuery({ queryKey: queryKeys.network(id), queryFn: () => networksApi.get(id), enabled: valid });

  if (!valid || (network.error instanceof ApiError && network.error.status === 404)) return <NotFound />;
  if (network.isError) return <LoadError error={network.error} onRetry={() => void network.refetch()} />;
  if (!network.data) {
    return (
      <Center py="xl">
        <Loader aria-label="Carregando rede" />
      </Center>
    );
  }
  return <NetworkDetailView network={network.data} />;
}

type IpEditing = { mode: 'new'; prefill?: IpPrefill } | { mode: 'edit'; record: IpRecordDto } | null;

const SOURCE_LABEL: Record<string, string> = { asset: 'Ativo', agent: 'Agente' };

function NetworkDetailView({ network }: { network: NetworkDetail }) {
  const { data: me } = useMe();
  const canManage = hasPermission(me, PERMISSIONS.docsManage);
  const queryClient = useQueryClient();
  const [editOpened, editModal] = useDisclosure(false);
  const [ipEditing, setIpEditing] = useState<IpEditing>(null);
  const ips = [...network.ips].sort((a, b) => compareIp(a.address, b.address));
  const discovered = [...network.discovered].sort((a, b) => compareIp(a.address, b.address));
  const percent = network.totalHosts > 0 ? (network.usedCount / network.totalHosts) * 100 : 0;

  const removeIp = useMutation({
    mutationFn: (ipId: number) => networksApi.removeIp(network.id, ipId),
    onSuccess: () => {
      notifySuccess('Registro de IP excluído.');
      void queryClient.invalidateQueries({ queryKey: queryKeys.networks });
    },
  });

  return (
    <>
      <Breadcrumbs mb="xs">
        <Anchor component={Link} to={docsTabPath('redes')} size="sm">
          Documentação
        </Anchor>
        <Anchor component={Link} to={docsTabPath('redes')} size="sm">
          Redes
        </Anchor>
        <Text size="sm">{network.name}</Text>
      </Breadcrumbs>
      <Group justify="space-between" align="flex-start" mb="lg" wrap="wrap" gap="sm">
        <Stack gap={6}>
          <Group gap="sm">
            <Title order={2}>{network.name}</Title>
            <Badge variant="light" size="lg" ff="monospace" tt="none">
              {network.cidr}
            </Badge>
            {network.vlanId && (
              <Badge variant="outline" size="lg" tt="none">
                VLAN {network.vlanId}
                {network.vlanName ? ` (${network.vlanName})` : ''}
              </Badge>
            )}
          </Group>
          <Text c="dimmed" size="sm">
            {network.clientName}
            {network.siteName ? ` / ${network.siteName}` : ''}
          </Text>
        </Stack>
        {canManage && (
          <Group gap="sm">
            <Button variant="default" leftSection={<IconPencil size={16} />} onClick={editModal.open}>
              Editar rede
            </Button>
            <Button leftSection={<IconPlus size={16} />} onClick={() => setIpEditing({ mode: 'new' })}>
              Adicionar IP
            </Button>
          </Group>
        )}
      </Group>

      <Stack>
        <Paper withBorder p="md">
          <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="lg">
            <Field label="Gateway">{network.gateway || <Missing />}</Field>
            <Field label="Servidores DNS">{network.dnsServers || <Missing />}</Field>
            <Field label="Faixa de DHCP">{network.dhcpRange || <Missing />}</Field>
            <Field label="Uso">
              <Group gap="xs" wrap="nowrap">
                <Progress value={percent} w={100} aria-label="Uso da rede" />
                <Text size="sm">
                  {network.usedCount} de {network.totalHosts}
                </Text>
              </Group>
            </Field>
          </SimpleGrid>
          {network.description && (
            <Text size="sm" mt="md" style={{ whiteSpace: 'pre-wrap' }}>
              {network.description}
            </Text>
          )}
        </Paper>

        <Paper withBorder component="section" aria-labelledby="ips-title">
          <Title order={4} id="ips-title" p="md" pb={0}>
            Endereços registrados
          </Title>
          <Table.ScrollContainer minWidth={850}>
            <Table verticalSpacing="xs" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={160}>Endereço</Table.Th>
                  <Table.Th>Hostname</Table.Th>
                  <Table.Th w={180}>Ativo</Table.Th>
                  <Table.Th w={170}>MAC</Table.Th>
                  <Table.Th w={110}>Tipo</Table.Th>
                  <Table.Th>Descrição</Table.Th>
                  <Table.Th w={80} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {ips.length === 0 && <EmptyRow columns={7} message="Nenhum endereço registrado nesta rede." />}
                {ips.map((ip) => (
                  <Table.Tr key={ip.id}>
                    <Table.Td>
                      <Text size="sm" ff="monospace" fw={600}>
                        {ip.address}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{ip.hostname ?? ''}</Text>
                    </Table.Td>
                    <Table.Td>
                      {ip.assetId ? (
                        <Anchor component={Link} to={assetPath(ip.assetId)} size="sm">
                          {ip.assetName ?? `Ativo #${ip.assetId}`}
                        </Anchor>
                      ) : null}
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" ff="monospace">
                        {ip.macAddress ?? ''}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <IpKindBadge kind={ip.kind} />
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" lineClamp={2}>
                        {ip.description ?? ''}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      {canManage && (
                        <Group gap={4} wrap="nowrap" justify="flex-end">
                          <Tooltip label="Editar">
                            <ActionIcon variant="subtle" color="gray" aria-label={`Editar ${ip.address}`} onClick={() => setIpEditing({ mode: 'edit', record: ip })}>
                              <IconPencil size={16} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label="Excluir">
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              aria-label={`Excluir ${ip.address}`}
                              onClick={() =>
                                confirmAction({
                                  title: 'Excluir registro de IP',
                                  message: `Excluir o registro de ${ip.address}?`,
                                  confirmLabel: 'Excluir',
                                  danger: true,
                                  onConfirm: () => removeIp.mutate(ip.id),
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
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>

        <Paper withBorder component="section" aria-labelledby="descobertos-title">
          <Group gap={8} p="md" pb={0}>
            <IconRadar size={18} stroke={1.6} color="var(--mantine-color-dimmed)" aria-hidden />
            <Title order={4} id="descobertos-title">
              Descobertos
            </Title>
          </Group>
          <Text size="sm" c="dimmed" px="md" pt={4}>
            Ativos e agentes com IP dentro desta faixa que ainda não têm registro.
          </Text>
          <Table.ScrollContainer minWidth={600}>
            <Table verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={160}>Endereço</Table.Th>
                  <Table.Th>Ativo</Table.Th>
                  <Table.Th w={120}>Origem</Table.Th>
                  <Table.Th w={140} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {discovered.length === 0 && <EmptyRow columns={4} message="Nenhum endereço novo encontrado." />}
                {discovered.map((item) => (
                  <Table.Tr key={`${item.address}-${item.assetId ?? 'sem-ativo'}`}>
                    <Table.Td>
                      <Text size="sm" ff="monospace">
                        {item.address}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      {item.assetId ? (
                        <Anchor component={Link} to={assetPath(item.assetId)} size="sm">
                          {item.assetName ?? `Ativo #${item.assetId}`}
                        </Anchor>
                      ) : (
                        <Text size="sm">{item.assetName ?? ''}</Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{SOURCE_LABEL[item.source] ?? item.source}</Text>
                    </Table.Td>
                    <Table.Td>
                      {canManage && (
                        <Button
                          size="compact-sm"
                          variant="light"
                          leftSection={<IconPlus size={14} />}
                          aria-label={`Registrar ${item.address}`}
                          onClick={() =>
                            setIpEditing({ mode: 'new', prefill: { address: item.address, assetId: item.assetId, assetName: item.assetName } })
                          }
                        >
                          Registrar
                        </Button>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      </Stack>

      {canManage && (
        <>
          <NetworkFormModal opened={editOpened} onClose={editModal.close} network={network} />
          <IpRecordFormModal
            opened={ipEditing !== null}
            onClose={() => setIpEditing(null)}
            network={network}
            record={ipEditing?.mode === 'edit' ? ipEditing.record : undefined}
            prefill={ipEditing?.mode === 'new' ? ipEditing.prefill : undefined}
          />
        </>
      )}
    </>
  );
}
