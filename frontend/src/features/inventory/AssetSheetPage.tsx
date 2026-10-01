import {
  Anchor,
  Badge,
  Breadcrumbs,
  Button,
  Center,
  Grid,
  Group,
  List,
  Loader,
  Paper,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Timeline,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconCpu,
  IconDeviceDesktopAnalytics,
  IconHistory,
  IconId,
  IconKey,
  IconNetwork,
  IconPackage,
  IconPaperclip,
  IconPencil,
  IconPrinter,
  IconTicket,
  IconTrash,
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiError } from '../../api/client';
import { assetsApi } from '../../api/inventory';
import { queryKeys } from '../../api/queryKeys';
import { PERMISSIONS, type AssetSheet, type MeDto } from '../../api/types';
import { agentPath, networkPath, PATHS, personPath, ticketPath } from '../../app/paths';
import { hasPermission } from '../../auth/permissions';
import { useMe } from '../../auth/useMe';
import { NotFound } from '../../components/NotFound';
import { LoadError } from '../../components/TableStates';
import { formatDate, formatDateTime } from '../../lib/format';
import { confirmAction, notifySuccess } from '../../lib/feedback';
import { AgentStatusBadge, OperatingSystem, RelativeTime } from '../agents/agentDisplay';
import { RemoteAccessMenu } from '../agents/actions/RemoteAccessMenu';
import { RevealSecret } from '../docs/credentials/RevealSecret';
import { DocAttachments } from '../docs/DocAttachments';
import { TicketStatusBadge } from '../tickets/TicketBadges';
import { AssetFormModal } from './AssetFormModal';
import { AssetStatusBadge, AssetTypeLabel, IpKindBadge } from './AssetBadges';
import { ASSET_TYPE_INFO, makeModel } from './inventoryFormat';
import { ResponsibleCard } from './ResponsibleCard';
import { Field, Missing, SheetCard } from './sheetDisplay';
import './print.css';

export function AssetSheetPage() {
  const { id: rawId } = useParams();
  const id = Number(rawId);
  const valid = Number.isInteger(id) && id > 0;
  const sheet = useQuery({ queryKey: queryKeys.assetSheet(id), queryFn: () => assetsApi.get(id), enabled: valid });

  if (!valid || (sheet.error instanceof ApiError && sheet.error.status === 404)) return <NotFound />;
  if (sheet.isError) return <LoadError error={sheet.error} onRetry={() => void sheet.refetch()} />;
  if (!sheet.data) {
    return (
      <Center py="xl">
        <Loader aria-label="Carregando ficha do ativo" />
      </Center>
    );
  }
  return <AssetSheetView sheet={sheet.data} />;
}

function AssetSheetView({ sheet }: { sheet: AssetSheet }) {
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const canManage = hasPermission(me, PERMISSIONS.inventoryManage);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: queryKeys.assetSheet(sheet.asset.id) });

  return (
    <>
      <Breadcrumbs mb="xs" className="no-print">
        <Anchor component={Link} to={PATHS.inventory} size="sm">
          Inventário
        </Anchor>
        <Text size="sm">{sheet.asset.name}</Text>
      </Breadcrumbs>
      <SheetHeader sheet={sheet} canManage={canManage} />
      <Grid gap="lg" className="sheet-grid">
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Stack>
            <HardwareCard sheet={sheet} />
            <SimpleGrid cols={{ base: 1, md: 2 }}>
              <MachineCard sheet={sheet} me={me} />
              <SoftwareCard sheet={sheet} me={me} />
            </SimpleGrid>
            <RegistrationCard sheet={sheet} />
            <NetworkCard sheet={sheet} me={me} />
            <CredentialsCard sheet={sheet} me={me} />
            <SheetCard id="anexos-title" title="Anexos" icon={IconPaperclip}>
              <DocAttachments ownerType="asset" ownerId={sheet.asset.id} attachments={sheet.attachments} canManage={canManage} onChanged={refresh} />
            </SheetCard>
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Stack>
            <ResponsibleCard sheet={sheet} canManage={canManage} />
            <TicketsCard sheet={sheet} me={me} />
            <HistoryCard sheet={sheet} />
          </Stack>
        </Grid.Col>
      </Grid>
    </>
  );
}

function SheetHeader({ sheet, canManage }: { sheet: AssetSheet; canManage: boolean }) {
  const { asset } = sheet;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editOpened, editModal] = useDisclosure(false);
  const TypeIcon = ASSET_TYPE_INFO[asset.type].icon;

  const remove = useMutation({
    mutationFn: () => assetsApi.remove(asset.id, { silent: true }),
    onSuccess: async () => {
      notifySuccess(`Ativo ${asset.name} excluído.`);
      queryClient.removeQueries({ queryKey: queryKeys.assetSheet(asset.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.assetLists });
      await navigate(PATHS.inventory);
    },
    onError: (error) => {
      const message =
        error instanceof ApiError && error.status === 409
          ? 'Este ativo pertence a uma máquina monitorada. Exclua o agente para liberar o ativo.'
          : error instanceof ApiError
            ? error.title
            : 'Não foi possível excluir o ativo.';
      notifications.show({ color: 'red', title: 'Excluir ativo', message });
    },
  });

  return (
    <Paper withBorder p="lg" mb="lg" component="header">
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="md">
        <Group gap="md" wrap="nowrap" align="flex-start">
          <Center
            w={56}
            h={56}
            style={{ borderRadius: 'var(--mantine-radius-md)', background: 'var(--mantine-color-blue-light)', flexShrink: 0 }}
            aria-hidden
          >
            <TypeIcon size={30} stroke={1.5} color="var(--mantine-color-blue-light-color)" />
          </Center>
          <Stack gap={6}>
            <Group gap="sm" wrap="wrap">
              <Title order={2} style={{ wordBreak: 'break-word' }}>
                {asset.name}
              </Title>
              <AssetStatusBadge status={asset.status} size="md" />
              {asset.agentStatus && <AgentStatusBadge status={asset.agentStatus} size="md" />}
            </Group>
            <Group gap="md" wrap="wrap">
              <AssetTypeLabel type={asset.type} />
              <Text size="sm">
                <Text span c="dimmed" size="sm">
                  Patrimônio:{' '}
                </Text>
                {asset.assetTag ?? 'sem número'}
              </Text>
              <Text size="sm" c="dimmed">
                {asset.clientName}
                {asset.siteName ? ` / ${asset.siteName}` : ''}
              </Text>
            </Group>
          </Stack>
        </Group>
        <Group gap="sm" className="no-print">
          <Button variant="default" leftSection={<IconPrinter size={16} />} onClick={() => window.print()}>
            Imprimir ficha
          </Button>
          {canManage && (
            <Button leftSection={<IconPencil size={16} />} onClick={editModal.open}>
              Editar
            </Button>
          )}
          {canManage && (
            <Button
              color="red"
              variant="light"
              leftSection={<IconTrash size={16} />}
              loading={remove.isPending}
              onClick={() =>
                confirmAction({
                  title: 'Excluir ativo',
                  message: `Excluir ${asset.name}? O histórico de responsáveis e os anexos serão perdidos.`,
                  confirmLabel: 'Excluir',
                  danger: true,
                  onConfirm: () => remove.mutate(),
                })
              }
            >
              Excluir
            </Button>
          )}
        </Group>
      </Group>
      {canManage && <AssetFormModal opened={editOpened} onClose={editModal.close} asset={asset} />}
    </Paper>
  );
}

function TextList({ items }: { items: string[] }) {
  if (items.length === 0) return <Missing />;
  if (items.length === 1) return <>{items[0]}</>;
  return (
    <List size="sm" spacing={2}>
      {items.map((item, index) => (
        <List.Item key={`${item}-${index}`}>{item}</List.Item>
      ))}
    </List>
  );
}

function HardwareCard({ sheet }: { sheet: AssetSheet }) {
  const { asset, hardware } = sheet;
  const fallbackModel = makeModel(asset.manufacturer, asset.model);
  return (
    <SheetCard
      id="hardware-title"
      title="Hardware"
      icon={IconCpu}
      actions={
        hardware && (
          <Badge variant="light" color={hardware.source === 'agent' ? 'teal' : 'gray'}>
            {hardware.source === 'agent' ? 'Coletado pelo agente' : 'Cadastro manual'}
          </Badge>
        )
      }
    >
      <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="lg">
        <Field label="Fabricante / modelo">{hardware?.makeModel || fallbackModel || <Missing />}</Field>
        <Field label="Número de série">{hardware?.serialNumber || asset.serialNumber || <Missing />}</Field>
        <Field label="Memória RAM">{hardware?.ramGb ? `${hardware.ramGb} GB` : <Missing />}</Field>
        <Field label="Processador">
          <TextList items={hardware?.cpus ?? []} />
        </Field>
        <Field label="Placa de vídeo">
          <TextList items={hardware?.gpus ?? []} />
        </Field>
        <Field label="Discos">
          <TextList items={hardware?.disks ?? []} />
        </Field>
        <Field label="IPs locais">
          <TextList items={hardware?.localIps ?? []} />
        </Field>
        <Field label="Sistema">{hardware?.operatingSystem || <Missing />}</Field>
        <Field label="Último usuário">{hardware?.lastLoggedInUser || <Missing />}</Field>
      </SimpleGrid>
      {!hardware && (
        <Text size="xs" c="dimmed" mt="md">
          Sem inventário de agente para este ativo. Fabricante, modelo e série vêm do cadastro.
        </Text>
      )}
      {hardware?.bootTime && (
        <Text size="xs" c="dimmed" mt="md">
          Último boot em {formatDateTime(hardware.bootTime)}
        </Text>
      )}
    </SheetCard>
  );
}

function MachineCard({ sheet, me }: { sheet: AssetSheet; me: MeDto | undefined }) {
  const { agent } = sheet;
  const canViewAgents = hasPermission(me, PERMISSIONS.agentsView);
  const canRemote = hasPermission(me, PERMISSIONS.agentsRemote);
  return (
    <SheetCard id="maquina-title" title="Máquina monitorada" icon={IconDeviceDesktopAnalytics}>
      {!agent ? (
        <Text size="sm" c="dimmed">
          Ativo sem agente instalado.
        </Text>
      ) : (
        <Stack gap="xs">
          <Group justify="space-between" wrap="nowrap">
            {canViewAgents ? (
              <Anchor component={Link} to={agentPath(agent.id)} fw={600}>
                {agent.hostname}
              </Anchor>
            ) : (
              <Text fw={600}>{agent.hostname}</Text>
            )}
            <AgentStatusBadge status={agent.status} />
          </Group>
          <OperatingSystem plat={agent.plat} operatingSystem={sheet.hardware?.operatingSystem ?? null} />
          <Text size="sm" c="dimmed">
            Visto por último <RelativeTime value={agent.lastSeen} />
          </Text>
          {canRemote && (
            <div className="no-print">
              <RemoteAccessMenu agent={agent} />
            </div>
          )}
        </Stack>
      )}
    </SheetCard>
  );
}

function SoftwareCard({ sheet, me }: { sheet: AssetSheet; me: MeDto | undefined }) {
  const { software, agent } = sheet;
  const canViewAgents = hasPermission(me, PERMISSIONS.agentsView);
  return (
    <SheetCard id="software-title" title="Software" icon={IconPackage}>
      {!software ? (
        <Text size="sm" c="dimmed">
          {agent ? 'O agente ainda não enviou a lista de programas.' : 'Disponível somente para máquinas monitoradas.'}
        </Text>
      ) : (
        <Stack gap={4}>
          <Text fz={28} fw={700} lh={1.1}>
            {software.count}
          </Text>
          <Text size="sm" c="dimmed">
            {software.count === 1 ? 'programa instalado' : 'programas instalados'}
            {software.updatedAt ? ` · atualizado em ${formatDateTime(software.updatedAt)}` : ''}
          </Text>
          {agent && canViewAgents && (
            <Anchor component={Link} to={`${agentPath(agent.id)}?aba=software`} size="sm" className="no-print">
              Ver lista de programas
            </Anchor>
          )}
        </Stack>
      )}
    </SheetCard>
  );
}

function warrantyBadge(until: string | null) {
  if (!until) return null;
  const expired = dayjs(until).isBefore(dayjs(), 'day');
  return (
    <Badge size="xs" variant="light" color={expired ? 'red' : 'teal'} ml={6}>
      {expired ? 'Vencida' : 'Vigente'}
    </Badge>
  );
}

function RegistrationCard({ sheet }: { sheet: AssetSheet }) {
  const { asset } = sheet;
  return (
    <SheetCard id="cadastro-title" title="Cadastro" icon={IconId}>
      <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="lg">
        <Field label="Localização">{asset.location || <Missing />}</Field>
        <Field label="Endereço IP">{asset.ipAddress ? <Text ff="monospace" size="sm" span>{asset.ipAddress}</Text> : <Missing />}</Field>
        <Field label="Endereço MAC">{asset.macAddress ? <Text ff="monospace" size="sm" span>{asset.macAddress}</Text> : <Missing />}</Field>
        <Field label="Data de compra">{asset.purchaseDate ? formatDate(asset.purchaseDate) : <Missing />}</Field>
        <Field label="Garantia até">
          {asset.warrantyUntil ? (
            <>
              {formatDate(asset.warrantyUntil)}
              {warrantyBadge(asset.warrantyUntil)}
            </>
          ) : (
            <Missing />
          )}
        </Field>
        <Field label="Atualizado em">{formatDateTime(asset.updatedAt)}</Field>
      </SimpleGrid>
      {asset.notes && (
        <Stack gap={2} mt="md">
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            Observações
          </Text>
          <Text size="sm" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {asset.notes}
          </Text>
        </Stack>
      )}
    </SheetCard>
  );
}

function NetworkCard({ sheet, me }: { sheet: AssetSheet; me: MeDto | undefined }) {
  const canViewDocs = hasPermission(me, PERMISSIONS.docsView);
  return (
    <SheetCard id="rede-title" title="Rede" icon={IconNetwork}>
      {sheet.network.length === 0 ? (
        <Text size="sm" c="dimmed">
          Nenhuma rede documentada contém os endereços deste ativo.
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={520}>
          <Table verticalSpacing={6}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Rede</Table.Th>
                <Table.Th>CIDR</Table.Th>
                <Table.Th>VLAN</Table.Th>
                <Table.Th>Endereço</Table.Th>
                <Table.Th>Tipo</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {sheet.network.map((entry, index) => (
                <Table.Tr key={`${entry.networkId}-${entry.address ?? index}`}>
                  <Table.Td>
                    {canViewDocs ? (
                      <Anchor component={Link} to={networkPath(entry.networkId)} size="sm">
                        {entry.networkName}
                      </Anchor>
                    ) : (
                      <Text size="sm">{entry.networkName}</Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" ff="monospace">
                      {entry.cidr}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{entry.vlanId ?? 'Sem VLAN'}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" ff="monospace">
                      {entry.address ?? 'Sem registro'}
                    </Text>
                  </Table.Td>
                  <Table.Td>{entry.kind ? <IpKindBadge kind={entry.kind} /> : <Missing text="Não registrado" />}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </SheetCard>
  );
}

function CredentialsCard({ sheet, me }: { sheet: AssetSheet; me: MeDto | undefined }) {
  const canReveal = hasPermission(me, PERMISSIONS.credentialsReveal);
  return (
    <SheetCard id="credenciais-title" title="Credenciais" icon={IconKey}>
      {sheet.credentials.length === 0 ? (
        <Text size="sm" c="dimmed">
          Nenhuma credencial vinculada a este ativo.
        </Text>
      ) : (
        <Stack gap="sm">
          {sheet.credentials.map((credential) => (
            <Group key={credential.id} justify="space-between" wrap="wrap" gap="xs">
              <div>
                <Text size="sm" fw={600}>
                  {credential.name}
                </Text>
                <Text size="xs" c="dimmed">
                  {credential.username ? `Usuário: ${credential.username}` : 'Sem usuário'}
                  {credential.url ? ` · ${credential.url}` : ''}
                </Text>
              </div>
              {canReveal && (
                <div className="no-print">
                  <RevealSecret credentialId={credential.id} name={credential.name} />
                </div>
              )}
            </Group>
          ))}
        </Stack>
      )}
    </SheetCard>
  );
}

function TicketsCard({ sheet, me }: { sheet: AssetSheet; me: MeDto | undefined }) {
  const canViewTickets = hasPermission(me, PERMISSIONS.ticketsView);
  const { open, recent } = sheet.tickets;
  return (
    <SheetCard
      id="chamados-title"
      title="Chamados"
      icon={IconTicket}
      actions={
        <Badge variant="light" color={open > 0 ? 'orange' : 'gray'}>
          {open === 1 ? '1 aberto' : `${open} abertos`}
        </Badge>
      }
    >
      {recent.length === 0 ? (
        <Text size="sm" c="dimmed">
          Nenhum chamado para esta máquina.
        </Text>
      ) : (
        <Stack gap="xs">
          {recent.map((ticket) => (
            <Group key={ticket.id} justify="space-between" wrap="nowrap" gap="xs" align="flex-start">
              <div style={{ minWidth: 0 }}>
                {canViewTickets ? (
                  <Anchor component={Link} to={ticketPath(ticket.id)} size="sm" lineClamp={2}>
                    #{ticket.id} {ticket.title}
                  </Anchor>
                ) : (
                  <Text size="sm" lineClamp={2}>
                    #{ticket.id} {ticket.title}
                  </Text>
                )}
                <Text size="xs" c="dimmed">
                  {formatDateTime(ticket.createdAt)}
                </Text>
              </div>
              <TicketStatusBadge status={ticket.status} />
            </Group>
          ))}
        </Stack>
      )}
    </SheetCard>
  );
}

function HistoryCard({ sheet }: { sheet: AssetSheet }) {
  const history = [...sheet.history].sort((a, b) => b.assignedAt.localeCompare(a.assignedAt));
  return (
    <SheetCard id="historico-title" title="Histórico de responsáveis" icon={IconHistory}>
      {history.length === 0 ? (
        <Text size="sm" c="dimmed">
          Este ativo ainda não teve responsáveis.
        </Text>
      ) : (
        <Timeline active={history.findIndex((h) => h.unassignedAt === null)} bulletSize={14} lineWidth={2} aria-label="Histórico de responsáveis">
          {history.map((entry) => (
            <Timeline.Item
              key={entry.id}
              title={
                <Anchor component={Link} to={personPath(entry.personId)} size="sm" fw={600}>
                  {entry.personName}
                </Anchor>
              }
            >
              <Text size="xs" c="dimmed">
                {entry.unassignedAt
                  ? `${formatDate(entry.assignedAt)} até ${formatDate(entry.unassignedAt)}`
                  : `Desde ${formatDate(entry.assignedAt)} (atual)`}
              </Text>
              <Text size="xs" c="dimmed">
                Por {entry.assignedBy}
              </Text>
              {entry.notes && (
                <Text size="sm" mt={4} style={{ whiteSpace: 'pre-wrap' }}>
                  {entry.notes}
                </Text>
              )}
            </Timeline.Item>
          ))}
        </Timeline>
      )}
    </SheetCard>
  );
}
