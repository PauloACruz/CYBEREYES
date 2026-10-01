import { useState } from 'react';
import { Alert, Button, Checkbox, Group, Paper, Select, Skeleton, Stack, Switch, Text, Title } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconDeviceFloppy, IconPlugConnectedX } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { agentsApi } from '../../api/agents';
import { ApiError } from '../../api/client';
import { queryKeys } from '../../api/queryKeys';
import type { SelfServiceSettings, WinCareCatalog } from '../../api/types';
import { wincareApi } from '../../api/wincare';
import { LoadError } from '../../components/TableStates';
import { notifySuccess } from '../../lib/feedback';
import { AGENT_NO_RESPONSE } from '../wincare/wincareFormat';

interface TaskOption {
  value: string;
  label: string;
  description?: string;
}

function selfServiceOptions(catalog: WinCareCatalog): { module: string; tasks: TaskOption[] }[] {
  return catalog.modules
    .map((m) => ({
      module: m.label,
      tasks: m.tasks.filter((t) => t.selfService).map((t) => ({ value: `${m.key}.${t.key}`, label: t.label, description: t.description || undefined })),
    }))
    .filter((group) => group.tasks.length > 0);
}

function CatalogAgentPicker({ value, onChange }: { value: string | null; onChange: (value: string | null) => void }) {
  const [opened, setOpened] = useState(false);
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search, 300);
  const [chosen, setChosen] = useState<{ value: string; label: string } | null>(null);
  const query = chosen && debounced === chosen.label ? '' : debounced;
  const agents = useQuery({
    queryKey: queryKeys.agentList({ page: 1, pageSize: 50, status: 'online', search: query }),
    queryFn: () => agentsApi.list({ page: 1, pageSize: 50, status: 'online', search: query }),
    enabled: opened,
  });
  const found = (agents.data?.items ?? []).map((a) => ({ value: String(a.id), label: `${a.hostname} (${a.clientName})` }));
  // Ao escolher, o texto da busca vira o rotulo; o item escolhido continua na lista.
  const data = chosen && !found.some((o) => o.value === chosen.value) ? [chosen, ...found] : found;
  return (
    <Select
      label="Agente para carregar o catálogo"
      description="Escolha uma máquina online; o catálogo mostra o que a versão instalada do agente sabe fazer."
      placeholder="Buscar agente online"
      searchable
      clearable
      data={data}
      value={value}
      searchValue={search}
      onSearchChange={setSearch}
      onDropdownOpen={() => setOpened(true)}
      onChange={(next, option) => {
        setChosen(next ? option : null);
        onChange(next);
      }}
      nothingFoundMessage={agents.isFetching ? 'Carregando...' : 'Nenhum agente online encontrado'}
      maw={480}
    />
  );
}

function SelfServiceForm({ initial }: { initial: SelfServiceSettings }) {
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [tasks, setTasks] = useState<ReadonlySet<string>>(() => new Set(initial.tasks));
  const [agentId, setAgentId] = useState<string | null>(null);
  const catalogAgent = agentId ? Number(agentId) : 0;
  const catalog = useQuery({
    queryKey: queryKeys.wincareCatalog(catalogAgent),
    queryFn: () => wincareApi.catalog(catalogAgent, { silent: true }),
    enabled: catalogAgent > 0,
    staleTime: 5 * 60_000,
  });

  const save = useMutation({
    mutationFn: () => wincareApi.saveSelfService({ enabled, tasks: [...tasks].sort() }),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.wincareSelfService, saved);
      notifySuccess('Configuração de autoatendimento salva.');
    },
  });

  const toggle = (value: string, checked: boolean) => {
    setTasks((prev) => {
      const next = new Set(prev);
      if (checked) next.add(value);
      else next.delete(value);
      return next;
    });
  };

  const groups = catalog.data ? selfServiceOptions(catalog.data) : [];
  const listed = new Set(groups.flatMap((g) => g.tasks.map((t) => t.value)));
  const others = [...tasks].filter((t) => !listed.has(t)).sort();

  return (
    <Paper withBorder p="lg">
      <Stack gap="md">
        <Switch label="Permitir autoatendimento no app do usuário" checked={enabled} onChange={(e) => setEnabled(e.currentTarget.checked)} />
        <CatalogAgentPicker value={agentId} onChange={setAgentId} />
        {catalog.isFetching && !catalog.data && <Skeleton height={80} />}
        {catalog.isError &&
          (catalog.error instanceof ApiError && catalog.error.status === 504 ? (
            <Alert color="orange" icon={<IconPlugConnectedX size={18} />} title={AGENT_NO_RESPONSE} />
          ) : (
            <LoadError error={catalog.error} onRetry={() => void catalog.refetch()} />
          ))}
        {catalog.data && groups.length === 0 && (
          <Text size="sm" c="dimmed">
            O catálogo deste agente não tem tarefas liberáveis para autoatendimento.
          </Text>
        )}
        {groups.map((group) => (
          <Stack key={group.module} gap={6}>
            <Text fw={600} size="sm">
              {group.module}
            </Text>
            {group.tasks.map((task) => (
              <Checkbox
                key={task.value}
                label={task.label}
                description={task.description}
                checked={tasks.has(task.value)}
                onChange={(e) => toggle(task.value, e.currentTarget.checked)}
              />
            ))}
          </Stack>
        ))}
        {others.length > 0 && (
          <Stack gap={6}>
            <Text fw={600} size="sm">
              {catalog.data ? 'Outras tarefas liberadas' : 'Tarefas liberadas'}
            </Text>
            {others.map((value) => (
              <Checkbox key={value} label={value} checked onChange={(e) => toggle(value, e.currentTarget.checked)} />
            ))}
          </Stack>
        )}
        {!catalog.data && others.length === 0 && (
          <Text size="sm" c="dimmed">
            Nenhuma tarefa liberada. Escolha um agente para ver as tarefas disponíveis.
          </Text>
        )}
        <Group justify="flex-end">
          <Button leftSection={<IconDeviceFloppy size={16} />} loading={save.isPending} onClick={() => save.mutate()}>
            Salvar
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}

export function SelfServiceSection() {
  const settings = useQuery({ queryKey: queryKeys.wincareSelfService, queryFn: wincareApi.selfService });
  return (
    <section aria-labelledby="self-service-title">
      <div>
        <Title order={3} id="self-service-title">
          Autoatendimento no app do usuário
        </Title>
        <Text size="sm" c="dimmed" mb="xs">
          Tarefas do WinCare que o próprio usuário pode executar pelo app da bandeja. Somente tarefas marcadas como seguras no catálogo podem ser liberadas.
        </Text>
      </div>
      {settings.isError && <LoadError error={settings.error} onRetry={() => void settings.refetch()} />}
      {settings.isPending && <Skeleton height={120} />}
      {settings.data && <SelfServiceForm initial={settings.data} />}
    </section>
  );
}
