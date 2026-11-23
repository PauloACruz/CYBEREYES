import { useState } from 'react';
import { Anchor, Badge, Button, Group, Paper, SegmentedControl, Select, SimpleGrid, Stack, Switch, Table, Text, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconPlus, IconSearch } from '@tabler/icons-react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { projectsApi, type ListProjectsParams, type ProjectListStatus, type ProjectPhase, type ProjectSummary } from '../../api/projects';
import { queryKeys } from '../../api/queryKeys';
import { PERMISSIONS } from '../../api/types';
import { projectPath } from '../../app/paths';
import { hasPermission } from '../../auth/permissions';
import { useMe } from '../../auth/useMe';
import { ClientBadges } from '../../components/ClientBadges';
import { PageHeader } from '../../components/PageHeader';
import { EmptyRow, LoadError, LoadingRows } from '../../components/TableStates';
import { PhaseBadge, ProgressSummary } from './ProjectBadges';
import { ProjectFormModal } from './ProjectFormModal';
import { periodLabel, recurrenceLabel } from './projectFormat';

const STATUS_FILTERS: { value: ProjectListStatus; label: string }[] = [
  { value: 'open', label: 'Em aberto' },
  { value: 'done', label: 'Concluídos' },
  { value: 'cancelled', label: 'Cancelados' },
  { value: 'all', label: 'Todos' },
];

type PhaseFilter = Extract<ProjectPhase, 'in_progress' | 'scheduled' | 'late'>;

function toStatus(value: string | null): ProjectListStatus {
  return STATUS_FILTERS.some((s) => s.value === value) ? (value as ProjectListStatus) : 'open';
}

function toPhase(value: string | null): PhaseFilter | null {
  return value === 'in_progress' || value === 'scheduled' || value === 'late' ? value : null;
}

function Tile({ label, value, color, active, onClick }: { label: string; value: number; color?: string; active: boolean; onClick: () => void }) {
  return (
    <Paper
      withBorder
      p="sm"
      component="button"
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{ textAlign: 'left', cursor: 'pointer', borderColor: active ? `var(--mantine-color-${color ?? 'blue'}-5)` : undefined }}
    >
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text size="xl" fw={700} c={value > 0 ? color : undefined}>
        {value}
      </Text>
    </Paper>
  );
}

function ProjectsTable({ projects, loading }: { projects: ProjectSummary[]; loading: boolean }) {
  return (
    <Table.ScrollContainer minWidth={900}>
      <Table verticalSpacing="sm" highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Projeto</Table.Th>
            <Table.Th>Clientes</Table.Th>
            <Table.Th>Responsável</Table.Th>
            <Table.Th>Período</Table.Th>
            <Table.Th>Progresso</Table.Th>
            <Table.Th>Situação</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {loading && <LoadingRows columns={6} />}
          {!loading && projects.length === 0 && <EmptyRow columns={6} message="Nenhum projeto encontrado." />}
          {projects.map((p) => (
            <Table.Tr key={p.id}>
              <Table.Td>
                <Stack gap={2}>
                  <Group gap={6} wrap="nowrap">
                    <Anchor component={Link} to={projectPath(p.id)} fw={600}>
                      {p.name}
                    </Anchor>
                    {p.myOpenTasks > 0 && (
                      <Badge size="xs" variant="filled" color="violet" title="Tarefas suas ainda abertas">
                        {p.myOpenTasks} {p.myOpenTasks === 1 ? 'minha' : 'minhas'}
                      </Badge>
                    )}
                  </Group>
                  <Text size="xs" c="dimmed">
                    {recurrenceLabel(p.recurrence, p.recurrenceInterval)}
                    {p.recurrence !== 'none' && ` · ciclo ${p.cycle}`}
                  </Text>
                </Stack>
              </Table.Td>
              <Table.Td>
                {p.clients.length > 0 ? (
                  <ClientBadges clients={p.clients} />
                ) : (
                  <Text size="sm" c="dimmed">
                    Interno
                  </Text>
                )}
              </Table.Td>
              <Table.Td>
                <Text size="sm">{p.owner?.name ?? '—'}</Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm">{periodLabel(p.startDate, p.dueDate)}</Text>
              </Table.Td>
              <Table.Td>
                <ProgressSummary progress={p.progress} compact />
              </Table.Td>
              <Table.Td>
                <PhaseBadge phase={p.phase} />
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

export function ProjectsPage() {
  const { data: me } = useMe();
  const canManage = hasPermission(me, PERMISSIONS.projectsManage);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('busca') ?? '');
  const [debounced] = useDebouncedValue(search.trim(), 300);
  const [creating, setCreating] = useState(false);

  const status = toStatus(searchParams.get('situacao'));
  const phase = status === 'open' ? toPhase(searchParams.get('fase')) : null;
  const clientParam = Number(searchParams.get('cliente'));
  const params: ListProjectsParams = {
    status,
    clientId: Number.isInteger(clientParam) && clientParam > 0 ? clientParam : undefined,
    search: debounced || undefined,
    mine: searchParams.get('meus') === '1' || undefined,
  };
  const updateParams = (changes: Record<string, string | null>) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace: true },
    );
  const updateParam = (key: string, value: string | null) => updateParams({ [key]: value });

  const list = useQuery({ queryKey: queryKeys.projectList(params), queryFn: () => projectsApi.list(params), placeholderData: keepPreviousData });
  const options = useQuery({ queryKey: queryKeys.projectOptions, queryFn: projectsApi.options, staleTime: 60_000 });

  const all = list.data ?? [];
  const projects = phase ? all.filter((p) => p.phase === phase) : all;
  const count = (value: ProjectPhase) => all.filter((p) => p.phase === value).length;
  const myTasks = all.reduce((sum, p) => sum + p.myOpenTasks, 0);

  return (
    <>
      <PageHeader
        title="Projetos"
        description="Trabalhos planejados com tarefas e responsáveis, nas estações de clientes e setores escolhidos ou internos, únicos ou recorrentes (por exemplo, a limpeza física mensal das estações de um cliente), com a documentação do andamento."
        actions={
          canManage && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setCreating(true)}>
              Novo projeto
            </Button>
          )
        }
      />

      {status === 'open' && (
        <SimpleGrid cols={{ base: 2, sm: 4 }} mb="md">
          <Tile label="Em andamento" value={count('in_progress')} active={phase === 'in_progress'} onClick={() => updateParam('fase', phase === 'in_progress' ? null : 'in_progress')} />
          <Tile label="Agendados" value={count('scheduled')} color="indigo" active={phase === 'scheduled'} onClick={() => updateParam('fase', phase === 'scheduled' ? null : 'scheduled')} />
          <Tile label="Atrasados" value={count('late')} color="red" active={phase === 'late'} onClick={() => updateParam('fase', phase === 'late' ? null : 'late')} />
          <Tile label="Minhas tarefas abertas" value={myTasks} color="violet" active={params.mine === true} onClick={() => updateParam('meus', params.mine ? null : '1')} />
        </SimpleGrid>
      )}

      <Group mb="md" gap="sm" wrap="wrap" align="flex-end">
        <SegmentedControl
          value={status}
          onChange={(value) => updateParams({ situacao: value === 'open' ? null : value, fase: null })}
          data={STATUS_FILTERS}
        />
        <Select
          placeholder="Todos os clientes"
          aria-label="Cliente"
          clearable
          searchable
          data={(options.data?.clients ?? []).map((c) => ({ value: String(c.id), label: c.name }))}
          value={params.clientId ? String(params.clientId) : null}
          onChange={(value) => updateParam('cliente', value)}
          w={220}
        />
        <TextInput
          placeholder="Buscar projeto"
          aria-label="Buscar projeto"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => {
            setSearch(e.currentTarget.value);
            updateParam('busca', e.currentTarget.value.trim() || null);
          }}
          w={240}
        />
        <Switch label="Só os meus" checked={params.mine === true} onChange={(e) => updateParam('meus', e.currentTarget.checked ? '1' : null)} />
      </Group>

      {list.isError && <LoadError error={list.error} onRetry={() => void list.refetch()} />}
      <Paper withBorder>
        <ProjectsTable projects={projects} loading={list.isPending} />
      </Paper>

      {canManage && (
        <ProjectFormModal
          opened={creating}
          project={null}
          onClose={() => setCreating(false)}
          onSaved={(saved) => {
            setCreating(false);
            void navigate(projectPath(saved.id));
          }}
        />
      )}
    </>
  );
}
