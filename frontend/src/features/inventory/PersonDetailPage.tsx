import { Anchor, Badge, Breadcrumbs, Button, Center, Grid, Group, Loader, Paper, SimpleGrid, Stack, Table, Text, Timeline, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconBox, IconHistory, IconPencil, IconTrash, IconUserCircle } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiError } from '../../api/client';
import { peopleApi } from '../../api/inventory';
import { queryKeys } from '../../api/queryKeys';
import { PERMISSIONS, type PersonDetail } from '../../api/types';
import { assetPath, PATHS } from '../../app/paths';
import { hasPermission } from '../../auth/permissions';
import { useMe } from '../../auth/useMe';
import { NotFound } from '../../components/NotFound';
import { EmptyRow, LoadError } from '../../components/TableStates';
import { formatDate } from '../../lib/format';
import { confirmAction, notifySuccess } from '../../lib/feedback';
import { AssetStatusBadge, AssetTypeLabel } from './AssetBadges';
import { notifyPersonDeleteError } from './personActions';
import { PersonFormModal } from './PersonFormModal';
import { Field, Missing, SheetCard } from './sheetDisplay';
import { PageTitle } from '../../components/PageTitle';

export function PersonDetailPage() {
  const { id: rawId } = useParams();
  const id = Number(rawId);
  const valid = Number.isInteger(id) && id > 0;
  const person = useQuery({ queryKey: queryKeys.person(id), queryFn: () => peopleApi.get(id), enabled: valid });

  if (!valid || (person.error instanceof ApiError && person.error.status === 404)) return <NotFound />;
  if (person.isError) return <LoadError error={person.error} onRetry={() => void person.refetch()} />;
  if (!person.data) {
    return (
      <Center py="xl">
        <Loader aria-label="Carregando pessoa" />
      </Center>
    );
  }
  return <PersonDetailView person={person.data} />;
}

function PersonDetailView({ person }: { person: PersonDetail }) {
  const { data: me } = useMe();
  const canManage = hasPermission(me, PERMISSIONS.inventoryManage);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [editOpened, editModal] = useDisclosure(false);
  const history = [...person.history].sort((a, b) => b.assignedAt.localeCompare(a.assignedAt));

  const remove = useMutation({
    mutationFn: () => peopleApi.remove(person.id, { silent: true }),
    onSuccess: async () => {
      notifySuccess('Pessoa excluída.');
      queryClient.removeQueries({ queryKey: queryKeys.person(person.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.peopleLists });
      await navigate(PATHS.people);
    },
    onError: notifyPersonDeleteError,
  });

  return (
    <>
      <Breadcrumbs mb="xs">
        <Anchor component={Link} to={PATHS.inventory} size="sm">
          Inventário
        </Anchor>
        <Anchor component={Link} to={PATHS.people} size="sm">
          Pessoas
        </Anchor>
        <Text size="sm">{person.name}</Text>
      </Breadcrumbs>
      <Group justify="space-between" align="flex-start" mb="lg" wrap="wrap" gap="sm">
        <PageTitle
          title={person.name}
          badges={
            <Badge variant="light" color={person.active ? 'teal' : 'gray'}>
              {person.active ? 'Ativa' : 'Inativa'}
            </Badge>
          }
          description={[person.clientName, person.department, person.jobTitle].filter(Boolean).join(' · ') || undefined}
        />
        {canManage && (
          <Group gap="sm">
            <Button leftSection={<IconPencil size={16} />} onClick={editModal.open}>
              Editar
            </Button>
            <Button
              color="red"
              variant="light"
              leftSection={<IconTrash size={16} />}
              loading={remove.isPending}
              onClick={() =>
                confirmAction({
                  title: 'Excluir pessoa',
                  message: `Excluir ${person.name}? Pessoas com ativos atribuídos só podem ser desativadas.`,
                  confirmLabel: 'Excluir',
                  danger: true,
                  onConfirm: () => remove.mutate(),
                })
              }
            >
              Excluir
            </Button>
          </Group>
        )}
      </Group>

      <Grid gap="lg">
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Stack>
            <SheetCard id="dados-title" title="Dados" icon={IconUserCircle}>
              <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="lg">
                <Field label="E-mail">
                  {person.email ? (
                    <Anchor href={`mailto:${person.email}`} size="sm">
                      {person.email}
                    </Anchor>
                  ) : (
                    <Missing />
                  )}
                </Field>
                <Field label="Telefone">{person.phone || <Missing />}</Field>
                <Field label="Usuário no sistema">{person.username || <Missing />}</Field>
                <Field label="Departamento">{person.department || <Missing />}</Field>
                <Field label="Cargo">{person.jobTitle || <Missing />}</Field>
              </SimpleGrid>
            </SheetCard>
            <Paper withBorder component="section" aria-labelledby="ativos-title">
              <Group gap={8} p="md" pb={0}>
                <IconBox size={18} stroke={1.6} color="var(--mantine-color-dimmed)" aria-hidden />
                <Title order={5} id="ativos-title">
                  Ativos atuais
                </Title>
              </Group>
              <Table.ScrollContainer minWidth={520}>
                <Table verticalSpacing="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Nome</Table.Th>
                      <Table.Th>Tipo</Table.Th>
                      <Table.Th>Patrimônio</Table.Th>
                      <Table.Th>Status</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {person.assets.length === 0 && <EmptyRow columns={4} message="Nenhum ativo sob responsabilidade desta pessoa." />}
                    {person.assets.map((asset) => (
                      <Table.Tr key={asset.id}>
                        <Table.Td>
                          <Anchor component={Link} to={assetPath(asset.id)} size="sm" fw={600}>
                            {asset.name}
                          </Anchor>
                        </Table.Td>
                        <Table.Td>
                          <AssetTypeLabel type={asset.type} />
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">{asset.assetTag ?? ''}</Text>
                        </Table.Td>
                        <Table.Td>{asset.status && <AssetStatusBadge status={asset.status} />}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Paper>
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <SheetCard id="historico-pessoa-title" title="Histórico" icon={IconHistory}>
            {history.length === 0 ? (
              <Text size="sm" c="dimmed">
                Nenhuma atribuição registrada.
              </Text>
            ) : (
              <Timeline bulletSize={14} lineWidth={2} active={history.length} aria-label="Histórico de ativos">
                {history.map((entry) => (
                  <Timeline.Item
                    key={entry.id}
                    color={entry.unassignedAt ? 'gray' : undefined}
                    title={
                      <Anchor component={Link} to={assetPath(entry.assetId)} size="sm" fw={600}>
                        {entry.assetName}
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
        </Grid.Col>
      </Grid>

      {canManage && <PersonFormModal opened={editOpened} onClose={editModal.close} person={person} />}
    </>
  );
}
