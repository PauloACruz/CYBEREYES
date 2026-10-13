import { useState } from 'react';
import { ActionIcon, Anchor, Badge, Button, Collapse, Group, Menu, Paper, Skeleton, Stack, Table, Text, Title, UnstyledButton } from '@mantine/core';
import { useDisclosure, useLocalStorage } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconBuilding,
  IconChevronRight,
  IconDots,
  IconLayoutNavbarCollapse,
  IconLayoutNavbarExpand,
  IconMapPin,
  IconPencil,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react';
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

function sitesLabel(count: number): string {
  return count === 1 ? '1 site' : `${count} sites`;
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
  // Clientes abertos ficam guardados neste navegador; a lista comeca recolhida.
  const [openIds, setOpenIds] = useLocalStorage<number[]>({ key: 'cybereyes:clientes-abertos', defaultValue: [] });
  const isOpen = (clientId: number) => openIds.includes(clientId);
  const setOpen = (clientId: number, open: boolean) =>
    setOpenIds((current) => (open ? [...new Set([...current, clientId])] : current.filter((id) => id !== clientId)));
  const allIds = clients.data?.map((c) => c.id) ?? [];
  const allOpen = allIds.length > 0 && allIds.every(isOpen);

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
        setOpen(client.id, true);
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
          <>
            {allIds.length > 1 && (
              <Button
                variant="default"
                leftSection={allOpen ? <IconLayoutNavbarCollapse size={16} /> : <IconLayoutNavbarExpand size={16} />}
                onClick={() => setOpenIds(allOpen ? [] : allIds)}
              >
                {allOpen ? 'Recolher todos' : 'Expandir todos'}
              </Button>
            )}
            {canManage && (
              <Button leftSection={<IconPlus size={16} />} onClick={createModal.open}>
                Novo cliente
              </Button>
            )}
          </>
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
      <Stack gap="xs">
        {clients.data?.map((client) => {
          const open = isOpen(client.id);
          const sitesId = `cliente-${client.id}-sites`;
          return (
            <Paper key={client.id} withBorder component="section" aria-label={client.name}>
              <Group justify="space-between" px="md" py="sm" wrap="nowrap">
                <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                  <Title order={4} style={{ minWidth: 0 }}>
                    <UnstyledButton
                      onClick={() => setOpen(client.id, !open)}
                      aria-expanded={open}
                      aria-controls={sitesId}
                      title={open ? 'Recolher os sites' : 'Expandir os sites'}
                      style={{ display: 'flex', alignItems: 'center', gap: 'var(--mantine-spacing-sm)', font: 'inherit', minWidth: 0 }}
                    >
                      <IconChevronRight
                        size={18}
                        aria-hidden
                        style={{ flexShrink: 0, transition: 'transform 150ms ease', transform: open ? 'rotate(90deg)' : undefined }}
                      />
                      <IconBuilding size={20} aria-hidden style={{ flexShrink: 0 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{client.name}</span>
                    </UnstyledButton>
                  </Title>
                  <Badge variant="light" color="gray" style={{ flexShrink: 0 }}>
                    {sitesLabel(client.sites.length)}
                  </Badge>
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
              <Collapse expanded={open} transitionDuration={150} id={sitesId}>
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
              </Collapse>
            </Paper>
          );
        })}
      </Stack>
      {canManage && <CreateClientModal opened={createOpened} onClose={createModal.close} />}
      <NameModal config={nameModal} onClose={() => setNameModal(null)} />
    </>
  );
}
