import { useState } from 'react';
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  List,
  NumberInput,
  Select,
  Skeleton,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconPlayerPlay, IconPlugConnectedX, IconRefreshAlert } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, errorDetail } from '../../api/client';
import { queryKeys } from '../../api/queryKeys';
import type { WinCareModule, WinCareParam, WinCareParamValue, WinCareRunDto, WinCareTask } from '../../api/types';
import { wincareApi } from '../../api/wincare';
import { LoadError } from '../../components/TableStates';
import { AGENT_BUSY_MESSAGE, AGENT_NO_RESPONSE } from './wincareFormat';

type ParamValues = Record<string, WinCareParamValue>;

function paramValue(values: ParamValues, param: WinCareParam): WinCareParamValue {
  return values[param.name] ?? param.default ?? (param.type === 'bool' ? false : '');
}

function isMissing(value: WinCareParamValue): boolean {
  return typeof value === 'string' && value.trim() === '';
}

function groupTasks(tasks: WinCareTask[]): [string, WinCareTask[]][] {
  const groups = new Map<string, WinCareTask[]>();
  for (const task of tasks) {
    const name = task.group || 'Geral';
    groups.set(name, [...(groups.get(name) ?? []), task]);
  }
  return [...groups.entries()];
}

export function TaskBadges({ task }: { task: Pick<WinCareTask, 'reboot' | 'dangerous'> }) {
  return (
    <>
      {task.reboot && (
        <Badge size="xs" color="yellow" variant="light" leftSection={<IconRefreshAlert size={10} aria-hidden />}>
          Exige reinício
        </Badge>
      )}
      {task.dangerous && (
        <Badge size="xs" color="red" variant="light" leftSection={<IconAlertTriangle size={10} aria-hidden />}>
          Atenção
        </Badge>
      )}
    </>
  );
}

interface ParamFieldProps {
  id: string;
  param: WinCareParam;
  value: WinCareParamValue;
  error: string | undefined;
  onChange: (value: WinCareParamValue) => void;
}

function ParamField({ id, param, value, error, onChange }: ParamFieldProps) {
  switch (param.type) {
    case 'bool':
      return <Switch id={id} label={param.label} checked={value === true} onChange={(e) => onChange(e.currentTarget.checked)} />;
    case 'number':
      return (
        <NumberInput
          id={id}
          label={param.label}
          withAsterisk={param.required}
          value={typeof value === 'boolean' ? '' : value}
          error={error}
          onChange={(v) => onChange(v)}
        />
      );
    case 'select':
      return (
        <Select
          id={id}
          label={param.label}
          withAsterisk={param.required}
          data={param.options ?? []}
          value={typeof value === 'string' && value !== '' ? value : null}
          error={error}
          clearable={!param.required}
          onChange={(v) => onChange(v ?? '')}
        />
      );
    default:
      return (
        <TextInput
          id={id}
          label={param.label}
          withAsterisk={param.required}
          value={String(value)}
          error={error}
          onChange={(e) => onChange(e.currentTarget.value)}
        />
      );
  }
}

interface ModuleFormProps {
  agentId: number;
  module: WinCareModule;
  canRun: boolean;
  onStarted: (run: WinCareRunDto) => void;
}

function ModuleForm({ agentId, module, canRun, onStarted }: ModuleFormProps) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(module.tasks.filter((t) => t.default).map((t) => t.key)));
  const [values, setValues] = useState<ParamValues>({});
  const [submitted, setSubmitted] = useState(false);

  const chosen = module.tasks.filter((t) => selected.has(t.key));
  const errors = new Map<string, string>();
  for (const task of chosen) {
    for (const param of task.params) {
      if (param.required && param.type !== 'bool' && isMissing(paramValue(values, param))) errors.set(param.name, 'Campo obrigatório');
    }
  }

  const start = useMutation({
    mutationFn: () => {
      const params: ParamValues = {};
      for (const task of chosen) {
        for (const param of task.params) {
          const value = paramValue(values, param);
          if (isMissing(value)) continue;
          params[param.name] = param.type === 'number' ? Number(value) : value;
        }
      }
      return wincareApi.start(
        agentId,
        { module: module.key, tasks: chosen.map((t) => t.key), ...(Object.keys(params).length > 0 ? { params } : {}) },
        { silent: true },
      );
    },
    onSuccess: (run) => {
      setSubmitted(false);
      onStarted(run);
    },
    onError: (error) => {
      let message = 'Não foi possível iniciar a execução.';
      if (error instanceof ApiError) {
        if (error.code === 'AGENT_BUSY') message = AGENT_BUSY_MESSAGE;
        else if (error.code === 'AGENT_TIMEOUT') message = AGENT_NO_RESPONSE;
        else message = error.problem.detail ?? `${error.title}. ${errorDetail(error)}`;
      }
      notifications.show({ color: 'red', title: `Executar ${module.label}`, message });
    },
  });

  const toggle = (key: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const execute = () => {
    setSubmitted(true);
    if (chosen.length === 0 || errors.size > 0) return;
    const dangerous = chosen.filter((t) => t.dangerous);
    if (dangerous.length === 0) {
      start.mutate();
      return;
    }
    modals.openConfirmModal({
      title: 'Confirmar tarefas que exigem atenção',
      centered: true,
      children: (
        <Stack gap="xs">
          <Text size="sm">As tarefas abaixo fazem alterações sensíveis na máquina. Deseja continuar?</Text>
          <List size="sm">
            {dangerous.map((t) => (
              <List.Item key={t.key}>{t.label}</List.Item>
            ))}
          </List>
        </Stack>
      ),
      labels: { confirm: 'Executar', cancel: 'Cancelar' },
      confirmProps: { color: 'red' },
      onConfirm: () => start.mutate(),
    });
  };

  return (
    <Stack gap="md">
      {module.description && (
        <Text size="sm" c="dimmed">
          {module.description}
        </Text>
      )}
      {groupTasks(module.tasks).map(([group, tasks]) => (
        <Stack key={group} gap="xs">
          <Title order={6}>{group}</Title>
          {tasks.map((task) => {
            const checked = selected.has(task.key);
            return (
              <Stack key={task.key} gap={6}>
                <Group gap="xs" wrap="nowrap" align="flex-start">
                  <Checkbox
                    id={`wc-${module.key}-${task.key}`}
                    label={task.label}
                    description={task.description || undefined}
                    checked={checked}
                    disabled={!canRun}
                    onChange={(e) => toggle(task.key, e.currentTarget.checked)}
                  />
                  <TaskBadges task={task} />
                </Group>
                {checked && task.params.length > 0 && (
                  <Stack gap="xs" pl={32}>
                    {task.params.map((param) => (
                      <ParamField
                        key={param.name}
                        id={`wc-${module.key}-${task.key}-${param.name}`}
                        param={param}
                        value={paramValue(values, param)}
                        error={submitted ? errors.get(param.name) : undefined}
                        onChange={(value) => setValues((prev) => ({ ...prev, [param.name]: value }))}
                      />
                    ))}
                  </Stack>
                )}
              </Stack>
            );
          })}
        </Stack>
      ))}
      {canRun && (
        <Group justify="space-between">
          <Text size="sm" c={submitted && chosen.length === 0 ? 'red' : 'dimmed'}>
            {chosen.length === 0
              ? 'Selecione ao menos uma tarefa.'
              : chosen.length === 1
                ? '1 tarefa selecionada'
                : `${chosen.length} tarefas selecionadas`}
          </Text>
          <Button leftSection={<IconPlayerPlay size={16} />} loading={start.isPending} onClick={execute}>
            Executar
          </Button>
        </Group>
      )}
    </Stack>
  );
}

interface CatalogPanelProps {
  agentId: number;
  canRun: boolean;
  onStarted: (run: WinCareRunDto) => void;
}

export function CatalogPanel({ agentId, canRun, onStarted }: CatalogPanelProps) {
  const queryClient = useQueryClient();
  const catalog = useQuery({
    queryKey: queryKeys.wincareCatalog(agentId),
    queryFn: () => wincareApi.catalog(agentId, { silent: true }),
    staleTime: 5 * 60_000,
  });

  if (catalog.isPending) return <Skeleton height={160} />;
  if (catalog.isError) {
    if (catalog.error instanceof ApiError && catalog.error.status === 504) {
      return (
        <Alert color="orange" icon={<IconPlugConnectedX size={18} />} title={AGENT_NO_RESPONSE}>
          <Text size="sm" mb="xs">
            Não foi possível obter o catálogo do WinCare. Verifique se a máquina está online.
          </Text>
          <Button size="xs" variant="light" color="orange" onClick={() => void catalog.refetch()}>
            Tentar novamente
          </Button>
        </Alert>
      );
    }
    return <LoadError error={catalog.error} onRetry={() => void catalog.refetch()} />;
  }
  const modules = catalog.data.modules;
  if (modules.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        Nenhum módulo do WinCare disponível para este sistema.
      </Text>
    );
  }
  return (
    <Accordion multiple variant="separated" defaultValue={[modules[0]?.key ?? '']}>
      {modules.map((module) => (
        <Accordion.Item key={module.key} value={module.key}>
          <Accordion.Control>
            <Text fw={600}>{module.label}</Text>
          </Accordion.Control>
          <Accordion.Panel>
            <ModuleForm
              agentId={agentId}
              module={module}
              canRun={canRun}
              onStarted={(run) => {
                queryClient.setQueryData(queryKeys.wincareRun(run.runId), { ...run, events: run.events ?? [] });
                void queryClient.invalidateQueries({ queryKey: queryKeys.wincareRunLists });
                onStarted(run);
              }}
            />
          </Accordion.Panel>
        </Accordion.Item>
      ))}
    </Accordion>
  );
}
