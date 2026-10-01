import { useState } from 'react';
import { ActionIcon, Anchor, Badge, Button, Group, Menu, Paper, Skeleton, Stack, Table, Text, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconBuilding, IconDots, IconMapPin, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { clientsApi } from '../../api/clients';
import { ApiError } from '../../api/client';
import { queryKeys } from '../../api/queryKeys';
import { PERMISSIONS, type ClientDto, type SiteDto } from '../../api/types';
import { PATHS } from '../../app/paths';
import { hasPermission } from '../../auth/permissions';
import { useMe } from '../../auth/useMe';
import { PageHeader } from '../../components/PageHeader';
import { LoadError } from '../../components/TableStates';
import { confirmAction, notifySuccess } from '../../lib/feedback';
import { CreateClientModal } from './CreateClientModal';
import { NameModal, type NameModalConfig } from './NameModal';
import { useClients } from './useClients';

function agentsLabel(count: number): string {
  return count === 1 ? '1 agente' : `${count} agentes`;
}

function agentsLink(clientId: number, siteId?: number): string {
  const params = new URLSearchParams({ cliente: String(clientId) });
  if (siteId) params.set('site', String(siteId));
  return `${PATHS.agents}?${params.toString()}`;
}

function notifyDeleteError(error: unknown): void {
  const message =
    error instanceof ApiError ? (error.problem.detail ?? error.title) : 'Falha de comunicação com o servidor.';
  notifications.show({ color: 'red', title: 'Não foi possível excluir', message });
}

export function ClientsPage() {
  const { data: me } = useMe();
  const canManage = hasPermission(me, PERMISSIONS.clientsManage);
  const canViewAgents = hasPermission(me, PERMISSIONS.agentsView);
  const queryClient = useQueryClient();
  const clients = useClients();
  const [createOpened, createModal] = useDisclosure(false);
  const [nameModal, setNameModal] = useState<NameModalConfig | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.clients });

  const removeClient = useMutation({
    mutationFn: (client: ClientDto) => clientsApi.remove(client.id, { silent: true }),
    onSuccess: async (_, client) => {
      notifySuccess(`Cliente ${client.name} excluído.`);
      await invalidate();
    },
    onError: notifyDeleteError,
  });
  const removeSite = useMutation({
    mutationFn: (site: SiteDto) => clientsApi.removeSite(site.id, { silent: true }),
    onSuccess: async (_, site) => {
      notifySuccess(`Site ${site.name} excluído.`);
      await invalidate();
    },
    onError: notifyDeleteError,
  });

  const renameClient = (client: ClientDto) =>
    setNameModal({
      title: 'Renomear cliente',
      label: 'Nome do cliente',
      submitLabel: 'Salvar',
      initialName: client.name,
      save: async (name) => {
        await clientsApi.rename(client.id, { name });
        notifySuccess('Cliente renomeado.');
        await invalidate();
      },
    });
  const addSite = (client: ClientDto) =>
    setNameModal({
      title: `Novo site em ${client.name}`,
      label: 'Nome do site',
      submitLabel: 'Adicionar site',
      initialName: '',
      save: async (name) => {
        await clientsApi.addSite(client.id, { name });
        notifySuccess(`Site ${name} adicionado.`);
        await invalidate();
      },
    });
  const renameSite = (site: SiteDto) =>
    setNameModal({
      title: 'Renomear site',
      label: 'Nome do site',
      submitLabel: 'Salvar',
      initialName: site.name,
      save: async (name) => {
        await clientsApi.renameSite(site.id, { name });
        notifySuccess('Site renomeado.');
        await invalidate();
      },
    });

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Clientes e seus sites (locais ou unidades). Todo agente pertence a um site."
        actions={
          canManage && (
            <Button leftSection={<IconPlus size={16} />} onClick={createModal.open}>
              Novo cliente
            </Button>
          )
        }
      />
      {clients.isError && <LoadError error={clients.error} onRetry={() => void clients.refetch()} />}
      {clients.isPending && (
        <Stack aria-hidden>
          <Skeleton height={120} radius="md" />
          <Skeleton height={120} radius="md" />
        </Stack>
      )}
      {clients.data?.length === 0 && (
        <Paper withBorder p="xl">
          <Text c="dimmed" ta="center">
            Nenhum cliente cadastrado.{canManage && ' Crie o primeiro cliente para poder instalar agentes.'}
          </Text>
        </Paper>
      )}
      <Stack>
        {clients.data?.map((client) => (
          <Paper key={client.id} withBorder component="section" aria-label={client.name}>
            <Group justify="space-between" p="md" wrap="nowrap">
              <Group gap="sm" wrap="nowrap">
                <IconBuilding size={20} aria-hidden />
                <Title order={4}>{client.name}</Title>
                {canViewAgents ? (
                  <Anchor component={Link} to={agentsLink(client.id)} size="sm">
                    {agentsLabel(client.agentCount)}
                  </Anchor>
                ) : (
                  <Badge variant="light" color="gray">
                    {agentsLabel(client.agentCount)}
                  </Badge>
                )}
              </Group>
              {canManage && (
                <Menu position="bottom-end" withinPortal>
                  <Menu.Target>
                    <ActionIcon variant="subtle" color="gray" aria-label={`Ações para o cliente ${client.name}`}>
                      <IconDots size={16} />
                    </ActionIcon>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Item leftSection={<IconPlus size={16} />} onClick={() => addSite(client)}>
                      Adicionar site
                    </Menu.Item>
                    <Menu.Item leftSection={<IconPencil size={16} />} onClick={() => renameClient(client)}>
                      Renomear
                    </Menu.Item>
                    <Menu.Divider />
                    <Menu.Item
                      color="red"
                      leftSection={<IconTrash size={16} />}
                      onClick={() =>
                        confirmAction({
                          title: 'Excluir cliente',
                          message: `Excluir o cliente ${client.name} e todos os seus sites? Esta ação não pode ser desfeita.`,
                          confirmLabel: 'Excluir',
                          danger: true,
                          onConfirm: () => removeClient.mutate(client),
                        })
                      }
                    >
                      Excluir
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              )}
            </Group>
            <Table verticalSpacing="xs" withRowBorders>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th pl="md">Site</Table.Th>
                  <Table.Th>Agentes</Table.Th>
                  <Table.Th w={60}>
                    <span className="mantine-visually-hidden">Ações</span>
                  </Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {client.sites.map((site) => (
                  <Table.Tr key={site.id}>
                    <Table.Td pl="md">
                      <Group gap={6} wrap="nowrap">
                        <IconMapPin size={16} aria-hidden />
                        <Text size="sm">{site.name}</Text>
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      {canViewAgents ? (
                        <Anchor component={Link} to={agentsLink(client.id, site.id)} size="sm">
                          {agentsLabel(site.agentCount)}
                        </Anchor>
                      ) : (
                        agentsLabel(site.agentCount)
                      )}
                    </Table.Td>
                    <Table.Td>
                      {canManage && (
                        <Menu position="bottom-end" withinPortal>
                          <Menu.Target>
                            <ActionIcon variant="subtle" color="gray" aria-label={`Ações para o site ${site.name}`}>
                              <IconDots size={16} />
                            </ActionIcon>
                          </Menu.Target>
                          <Menu.Dropdown>
                            <Menu.Item leftSection={<IconPencil size={16} />} onClick={() => renameSite(site)}>
                              Renomear
                            </Menu.Item>
                            <Menu.Item
                              color="red"
                              leftSection={<IconTrash size={16} />}
                              onClick={() =>
                                confirmAction({
                                  title: 'Excluir site',
                                  message: `Excluir o site ${site.name} do cliente ${client.name}? Esta ação não pode ser desfeita.`,
                                  confirmLabel: 'Excluir',
                                  danger: true,
                                  onConfirm: () => removeSite.mutate(site),
                                })
                              }
                            >
                              Excluir
                            </Menu.Item>
                          </Menu.Dropdown>
                        </Menu>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Paper>
        ))}
      </Stack>
      {canManage && <CreateClientModal opened={createOpened} onClose={createModal.close} />}
      <NameModal config={nameModal} onClose={() => setNameModal(null)} />
    </>
  );
}
