import { useState, type ReactNode } from 'react';
import {
  Alert,
  Anchor,
  Badge,
  Breadcrumbs,
  Button,
  Center,
  Group,
  Loader,
  Menu,
  Modal,
  Paper,
  Radio,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  Textarea,
} from '@mantine/core';
import {
  IconCheck,
  IconChevronDown,
  IconDeviceDesktop,
  IconDots,
  IconHistory,
  IconListCheck,
  IconNotebook,
  IconPencil,
  IconPlayerPause,
  IconPlayerPlay,
  IconRefresh,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ApiError } from '../../api/client';
import { projectsApi, type ProjectDetail, type ProjectStatus } from '../../api/projects';
import { queryKeys } from '../../api/queryKeys';
import { PATHS } from '../../app/paths';
import { NotFound } from '../../components/NotFound';
import { PageTitle } from '../../components/PageTitle';
import { LoadError } from '../../components/TableStates';
import { confirmAction, notifySuccess } from '../../lib/feedback';
import { formatDateTime } from '../../lib/format';
import { PhaseBadge, ProgressSummary } from './ProjectBadges';
import { ProjectCycles } from './ProjectCycles';
import { formatDay, isFinished, periodLabel, recurrenceLabel } from './projectFormat';
import { ProjectFormModal } from './ProjectFormModal';
import { ProjectJournal } from './ProjectJournal';
import { ProjectStations } from './ProjectStations';
import { ProjectTasks } from './ProjectTasks';
import { refreshProject } from './projectActions';
import { ProgressModal, type ProgressTarget } from './ProgressModal';

export function ProjectDetailPage() {
  const { id: rawId } = useParams();
  const id = Number(rawId);
  const valid = Number.isInteger(id) && id > 0;
  const project = useQuery({ queryKey: queryKeys.project(id), queryFn: () => projectsApi.get(id), enabled: valid });

  if (!valid || (project.error instanceof ApiError && project.error.status === 404)) return <NotFound />;
  if (project.isError) return <LoadError error={project.error} onRetry={() => void project.refetch()} />;
  if (!project.data) {
    return (
      <Center py="xl">
        <Loader aria-label="Carregando projeto" />
      </Center>
    );
  }
  return <ProjectView project={project.data} />;
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Paper withBorder p="sm">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600} mb={4}>
        {label}
      </Text>
      {children}
    </Paper>
  );
}

function CloseCycleModal({ project, opened, onClose }: { project: ProjectDetail; opened: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const recurring = project.recurrence !== 'none';
  const [summary, setSummary] = useState('');
  const [mode, setMode] = useState<'next' | 'finish'>('next');
  const open = project.agents.filter((a) => !isFinished(a.status)).length + project.tasks.filter((t) => !isFinished(t.status)).length;
  const close = useMutation({
    mutationFn: () => projectsApi.closeCycle(project.id, { summary: summary.trim() || null, finish: !recurring || mode === 'finish' }),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.project(project.id), saved);
      refreshProject(queryClient, project.id);
      notifySuccess(saved.status === 'done' ? 'Projeto concluído.' : `Ciclo ${project.cycle} concluído; o ciclo ${saved.cycle} começou.`);
      setSummary('');
      onClose();
    },
  });
  return (
    <Modal opened={opened} onClose={onClose} title={recurring ? `Concluir o ciclo ${project.cycle}` : 'Concluir o projeto'} size="lg">
      <Stack gap="sm">
        {open > 0 && (
          <Alert color="yellow" p="xs">
            {open === 1 ? 'Ainda há 1 item sem concluir' : `Ainda há ${open} itens sem concluir`}; eles vão para o histórico como estão.
          </Alert>
        )}
        {recurring && (
          <Radio.Group value={mode} onChange={(v) => setMode(v)} label="Depois de concluir">
            <Stack gap={6} mt={6}>
              <Radio
                value="next"
                label={`Começar o ciclo ${project.cycle + 1}`}
                description={`Estações e tarefas voltam a pendentes e as datas avançam (${recurrenceLabel(project.recurrence, project.recurrenceInterval).toLowerCase()}); próximo início a partir de ${formatDay(project.nextStartDate)}.`}
              />
              <Radio value="finish" label="Encerrar o projeto" description="Não haverá novos ciclos; dá para reabrir depois." />
            </Stack>
          </Radio.Group>
        )}
        <Textarea
          label="Resumo"
          placeholder="Como foi, o que ficou pendente, o que mudar no próximo…"
          autosize
          minRows={3}
          maxRows={8}
          value={summary}
          onChange={(e) => setSummary(e.currentTarget.value)}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button color="teal" leftSection={<IconCheck size={16} />} onClick={() => close.mutate()} loading={close.isPending}>
            Concluir
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

const TABS = ['estacoes', 'tarefas', 'documentacao', 'ciclos'] as const;
type Tab = (typeof TABS)[number];

function ProjectView({ project }: { project: ProjectDetail }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [editing, setEditing] = useState(false);
  const [closing, setClosing] = useState(false);
  const [target, setTarget] = useState<ProgressTarget | null>(null);
  const manage = project.can.manage;
  const open = project.status === 'active' || project.status === 'paused';
  const recurring = project.recurrence !== 'none' || project.closedCycles > 0;

  const setStatus = useMutation({
    mutationFn: (status: ProjectStatus) => projectsApi.setStatus(project.id, status),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.project(project.id), saved);
      refreshProject(queryClient, project.id);
    },
  });
  const remove = useMutation({
    mutationFn: () => projectsApi.remove(project.id),
    onSuccess: async () => {
      notifySuccess(`Projeto ${project.name} excluído.`);
      queryClient.removeQueries({ queryKey: queryKeys.project(project.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      await navigate(PATHS.projects);
    },
  });

  const available: Tab[] = TABS.filter((t) => (t !== 'estacoes' || project.agents.length > 0) && (t !== 'ciclos' || recurring));
  const requested = searchParams.get('aba');
  const firstTab: Tab = available[0] ?? 'tarefas';
  const activeTab: Tab = available.find((t) => t === requested) ?? firstTab;
  const selectTab = (value: string | null) => {
    if (!value) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === firstTab) next.delete('aba');
        else next.set('aba', value);
        return next;
      },
      { replace: true },
    );
  };

  const subtitle = [
    recurrenceLabel(project.recurrence, project.recurrenceInterval),
    project.recurrence !== 'none' ? `ciclo ${project.cycle}` : null,
    `criado por ${project.createdByName} em ${formatDateTime(project.createdAt)}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <Breadcrumbs mb="xs">
        <Anchor component={Link} to={PATHS.projects} size="sm">
          Projetos
        </Anchor>
        <Text size="sm">{project.name}</Text>
      </Breadcrumbs>
      <Group justify="space-between" align="flex-start" mb="md" wrap="wrap" gap="sm">
        <PageTitle title={project.name} description={subtitle} />
        {manage && (
          <Group gap="xs">
            {open && (
              <Button color="teal" leftSection={<IconCheck size={16} />} onClick={() => setClosing(true)}>
                {project.recurrence !== 'none' ? 'Concluir ciclo' : 'Concluir projeto'}
              </Button>
            )}
            <Button variant="default" leftSection={<IconPencil size={16} />} onClick={() => setEditing(true)} disabled={!open}>
              Editar
            </Button>
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <Button variant="default" rightSection={<IconChevronDown size={14} />} leftSection={<IconDots size={16} />} aria-label="Mais ações">
                  Mais
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                {project.status === 'active' && (
                  <Menu.Item leftSection={<IconPlayerPause size={14} />} onClick={() => setStatus.mutate('paused')}>
                    Pausar
                  </Menu.Item>
                )}
                {project.status === 'paused' && (
                  <Menu.Item leftSection={<IconPlayerPlay size={14} />} onClick={() => setStatus.mutate('active')}>
                    Retomar
                  </Menu.Item>
                )}
                {open && (
                  <Menu.Item
                    leftSection={<IconX size={14} />}
                    onClick={() =>
                      confirmAction({
                        title: 'Cancelar projeto',
                        message: 'O projeto fica cancelado, sem novos registros; dá para reabrir depois.',
                        confirmLabel: 'Cancelar projeto',
                        danger: true,
                        onConfirm: () => setStatus.mutate('cancelled'),
                      })
                    }
                  >
                    Cancelar projeto
                  </Menu.Item>
                )}
                {!open && (
                  <Menu.Item leftSection={<IconRefresh size={14} />} onClick={() => setStatus.mutate('active')}>
                    Reabrir
                  </Menu.Item>
                )}
                <Menu.Divider />
                <Menu.Item
                  color="red"
                  leftSection={<IconTrash size={14} />}
                  onClick={() =>
                    confirmAction({
                      title: 'Excluir projeto',
                      message: `Excluir "${project.name}" com tarefas, documentação, anexos e histórico de ciclos? Não dá para desfazer.`,
                      confirmLabel: 'Excluir',
                      danger: true,
                      onConfirm: () => remove.mutate(),
                    })
                  }
                >
                  Excluir
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        )}
      </Group>

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} mb="md">
        <Info label="Situação">
          <PhaseBadge phase={project.phase} />
          {project.completedAt && (
            <Text size="xs" c="dimmed" mt={4}>
              em {formatDateTime(project.completedAt)}
            </Text>
          )}
        </Info>
        <Info label="Responsável">
          <Text size="sm">{project.owner?.name ?? 'Ninguém'}</Text>
        </Info>
        <Info label={project.recurrence !== 'none' ? `Ciclo ${project.cycle}` : 'Período'}>
          <Text size="sm">{periodLabel(project.startDate, project.dueDate)}</Text>
          {project.recurrence !== 'none' && open && (
            <Text size="xs" c="dimmed">
              Próximo ciclo a partir de {formatDay(project.nextStartDate)}
            </Text>
          )}
        </Info>
        <Info label="Progresso">
          <ProgressSummary progress={project.progress} />
        </Info>
      </SimpleGrid>

      {(project.description || project.clients.length > 0 || project.sites.length > 0) && (
        <Paper withBorder p="sm" mb="md">
          <Stack gap="xs">
            {project.description && (
              <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                {project.description}
              </Text>
            )}
            {(project.clients.length > 0 || project.sites.length > 0) && (
              <Group gap={6} wrap="wrap">
                {project.clients.map((c) => (
                  <Badge key={`c${c.id}`} variant="outline">
                    {c.name}
                  </Badge>
                ))}
                {project.sites.map((s) => (
                  <Badge key={`s${s.id}`} variant="light" color="gray">
                    {s.clientName} / {s.name}
                  </Badge>
                ))}
              </Group>
            )}
          </Stack>
        </Paper>
      )}

      {project.status === 'paused' && (
        <Alert color="yellow" mb="md">
          Projeto pausado. O andamento ainda pode ser registrado.
        </Alert>
      )}

      <Tabs value={activeTab} onChange={selectTab} keepMounted={false}>
        <Tabs.List mb="md">
          {available.includes('estacoes') && (
            <Tabs.Tab value="estacoes" leftSection={<IconDeviceDesktop size={16} />}>
              Estações ({project.progress.agentsFinished}/{project.agents.length})
            </Tabs.Tab>
          )}
          <Tabs.Tab value="tarefas" leftSection={<IconListCheck size={16} />}>
            Tarefas ({project.progress.tasksFinished}/{project.tasks.length})
          </Tabs.Tab>
          <Tabs.Tab value="documentacao" leftSection={<IconNotebook size={16} />}>
            Documentação
          </Tabs.Tab>
          {available.includes('ciclos') && (
            <Tabs.Tab value="ciclos" leftSection={<IconHistory size={16} />}>
              Ciclos concluídos ({project.closedCycles})
            </Tabs.Tab>
          )}
        </Tabs.List>
        <Tabs.Panel value="estacoes">
          <ProjectStations project={project} onRecord={setTarget} />
        </Tabs.Panel>
        <Tabs.Panel value="tarefas">
          <ProjectTasks project={project} onRecord={setTarget} />
        </Tabs.Panel>
        <Tabs.Panel value="documentacao">
          <ProjectJournal project={project} />
        </Tabs.Panel>
        <Tabs.Panel value="ciclos">
          <ProjectCycles project={project} />
        </Tabs.Panel>
      </Tabs>

      <ProgressModal projectId={project.id} target={target} onClose={() => setTarget(null)} />
      {manage && <CloseCycleModal project={project} opened={closing} onClose={() => setClosing(false)} />}
      {manage && (
        <ProjectFormModal opened={editing} project={project} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />
      )}
    </>
  );
}
