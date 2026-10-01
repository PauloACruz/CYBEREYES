import { useMemo } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Chip,
  Divider,
  Group,
  Input,
  Modal,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { DateTimePicker, TimeInput } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { IconArrowDown, IconArrowUp, IconInfoCircle, IconPlus, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { tasksApi } from '../../../api/monitoring';
import { queryKeys } from '../../../api/queryKeys';
import { scriptsApi } from '../../../api/scripts';
import { PERMISSIONS, type CommandShell, type SaveTaskRequest, type TaskDto, type TaskScheduleType } from '../../../api/types';
import { hasPermission } from '../../../auth/permissions';
import { useMe } from '../../../auth/useMe';
import { StringListInput } from '../../../components/StringListInput';
import { notifySuccess } from '../../../lib/feedback';
import { applyServerErrors } from '../../../lib/forms';
import { defaultShell, isWindows, shellsFor } from '../../agents/actions/shells';
import { supportsPlatform } from '../../scripts/scriptMeta';
import type { CheckOwner } from '../checks/checkForm';
import { isSeverity, SEVERITY_OPTIONS, WEEKDAYS } from '../monitoringFormat';
import { describeSchedule } from './schedule';
import {
  ALL_SHELLS,
  buildTaskBody,
  defaultTaskValues,
  moveItem,
  newAction,
  SCHEDULE_OPTIONS,
  taskToValues,
  validateTask,
  type ActionDraft,
  type TaskFormValues,
} from './taskForm';

interface TaskFormModalProps {
  opened: boolean;
  onClose: () => void;
  owner: CheckOwner;
  current: TaskDto | null;
  /** Plataforma do agente; ausente em politicas. */
  plat?: string;
  /** Checks que podem disparar a tarefa (agendamento "ao falhar um check"). */
  checkOptions: { value: string; label: string }[];
  onSaved: () => void;
}

export function TaskFormModal({ opened, onClose, current, ...rest }: TaskFormModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} title={current ? 'Editar tarefa' : 'Nova tarefa'} size="xl" centered>
      {opened && <TaskForm key={current?.id ?? 'nova'} current={current} onClose={onClose} {...rest} />}
    </Modal>
  );
}

const isSchedule = (v: string | null): v is TaskScheduleType => SCHEDULE_OPTIONS.some((o) => o.value === v);

function TaskForm({ current, owner, plat, checkOptions, onClose, onSaved }: Omit<TaskFormModalProps, 'opened'>) {
  const { data: me } = useMe();
  const canViewScripts = hasPermission(me, PERMISSIONS.scriptsView);
  const shells = plat === undefined ? ALL_SHELLS : shellsFor(plat).map((s) => ({ value: s.value, label: s.label }));
  const firstShell: CommandShell = plat === undefined ? 'cmd' : defaultShell(plat);
  const showRunAsUser = plat === undefined || isWindows(plat);

  const form = useForm<TaskFormValues>({
    initialValues: current ? taskToValues(current) : defaultTaskValues(),
    validate: (values) => validateTask(values),
  });
  const values = form.values;

  const scripts = useQuery({ queryKey: queryKeys.scripts, queryFn: scriptsApi.list, enabled: canViewScripts });
  const scriptOptions = useMemo(
    () =>
      (scripts.data ?? [])
        .filter((s) => plat === undefined || supportsPlatform(s, plat))
        .map((s) => ({ value: String(s.id), label: s.category ? `${s.category} / ${s.name}` : s.name })),
    [scripts.data, plat],
  );

  const save = useMutation({
    mutationFn: (body: SaveTaskRequest) => (current ? tasksApi.update(current.id, body) : tasksApi.create(body)),
    onSuccess: () => {
      notifySuccess(current ? 'Tarefa atualizada.' : 'Tarefa criada.');
      onSaved();
      onClose();
    },
    onError: (error) => applyServerErrors(form, error),
  });

  const setAction = (index: number, patch: Partial<ActionDraft>) =>
    form.setFieldValue(
      'actions',
      values.actions.map((a, i) => (i === index ? { ...a, ...patch } : a)),
    );
  const addAction = (type: 'cmd' | 'script') => form.setFieldValue('actions', [...values.actions, newAction(type, firstShell)]);
  const removeAction = (index: number) => form.setFieldValue('actions', values.actions.filter((_, i) => i !== index));
  const move = (from: number, to: number) => form.setFieldValue('actions', moveItem(values.actions, from, to));

  const preview = buildTaskBody(values, owner);
  const checkLabel = checkOptions.find((c) => c.value === values.assignedCheckId)?.label;
  const type = values.scheduleType;

  return (
    <form onSubmit={form.onSubmit((v) => save.mutate(buildTaskBody(v, owner)))} noValidate>
      <Stack>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label="Nome" required {...form.getInputProps('name')} />
          <Select
            label="Severidade do alerta"
            allowDeselect={false}
            data={SEVERITY_OPTIONS}
            value={values.alertSeverity}
            onChange={(v) => isSeverity(v) && form.setFieldValue('alertSeverity', v)}
          />
        </SimpleGrid>
        <Group gap="xl">
          <Switch label="Ativa" {...form.getInputProps('enabled', { type: 'checkbox' })} />
          <Switch label="Continuar se uma ação falhar" {...form.getInputProps('continueOnError', { type: 'checkbox' })} />
        </Group>

        <Divider label="Ações" labelPosition="left" />
        {values.actions.length === 0 && (
          <Text size="sm" c={form.errors.actions ? 'red' : 'dimmed'}>
            {form.errors.actions ?? 'Nenhuma ação. Adicione comandos ou scripts; eles rodam na ordem da lista.'}
          </Text>
        )}
        <Stack gap="sm">
          {values.actions.map((action, index) => (
            <Paper key={action.key} withBorder p="sm">
              <Stack gap="xs">
                <Group justify="space-between">
                  <Group gap="xs">
                    <Badge variant="light" color="gray">
                      {index + 1}
                    </Badge>
                    <Badge variant="light" color={action.type === 'cmd' ? 'blue' : 'grape'}>
                      {action.type === 'cmd' ? 'Comando' : 'Script'}
                    </Badge>
                  </Group>
                  <Group gap={4}>
                    <Tooltip label="Mover para cima">
                      <ActionIcon variant="subtle" color="gray" aria-label={`Mover ação ${index + 1} para cima`} disabled={index === 0} onClick={() => move(index, index - 1)}>
                        <IconArrowUp size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Mover para baixo">
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        aria-label={`Mover ação ${index + 1} para baixo`}
                        disabled={index === values.actions.length - 1}
                        onClick={() => move(index, index + 1)}
                      >
                        <IconArrowDown size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Remover">
                      <ActionIcon variant="subtle" color="red" aria-label={`Remover ação ${index + 1}`} onClick={() => removeAction(index)}>
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Group>
                {action.type === 'cmd' ? (
                  <>
                    <Group align="flex-start" grow>
                      <Select
                        label="Shell"
                        allowDeselect={false}
                        data={shells}
                        value={action.shell}
                        onChange={(v) => v && setAction(index, { shell: v })}
                      />
                      <NumberInput
                        label="Tempo limite (s)"
                        min={5}
                        max={86400}
                        allowDecimal={false}
                        value={action.timeout}
                        error={form.errors[`actions.${index}.timeout`]}
                        onChange={(v) => setAction(index, { timeout: typeof v === 'number' ? v : Number.parseInt(v, 10) })}
                      />
                    </Group>
                    <Textarea
                      label="Comando"
                      ff="monospace"
                      autosize
                      minRows={2}
                      value={action.command}
                      error={form.errors[`actions.${index}.command`]}
                      onChange={(e) => setAction(index, { command: e.currentTarget.value })}
                    />
                  </>
                ) : (
                  <>
                    <Group align="flex-start" grow>
                      <Select
                        label="Script"
                        searchable
                        placeholder={canViewScripts ? 'Escolha um script' : 'Sem permissão para ver scripts'}
                        nothingFoundMessage="Nenhum script compatível"
                        data={scriptOptions}
                        disabled={!canViewScripts}
                        value={action.scriptId}
                        error={form.errors[`actions.${index}.scriptId`]}
                        onChange={(v) => setAction(index, { scriptId: v })}
                      />
                      <NumberInput
                        label="Tempo limite (s)"
                        min={5}
                        max={86400}
                        allowDecimal={false}
                        value={action.timeout}
                        error={form.errors[`actions.${index}.timeout`]}
                        onChange={(v) => setAction(index, { timeout: typeof v === 'number' ? v : Number.parseInt(v, 10) })}
                      />
                    </Group>
                    <SimpleGrid cols={{ base: 1, md: 2 }}>
                      <StringListInput
                        label="Argumentos"
                        addLabel="Adicionar argumento"
                        value={action.args}
                        onChange={(args) => setAction(index, { args })}
                      />
                      <StringListInput
                        label="Variáveis de ambiente"
                        description="No formato NOME=valor"
                        addLabel="Adicionar variável"
                        value={action.envVars}
                        onChange={(envVars) => setAction(index, { envVars })}
                      />
                    </SimpleGrid>
                    {showRunAsUser && (
                      <Switch
                        label="Executar como o usuário logado (Windows)"
                        checked={action.runAsUser}
                        onChange={(e) => setAction(index, { runAsUser: e.currentTarget.checked })}
                      />
                    )}
                  </>
                )}
              </Stack>
            </Paper>
          ))}
        </Stack>
        <Group gap="sm">
          <Button variant="light" size="xs" leftSection={<IconPlus size={14} />} onClick={() => addAction('cmd')}>
            Adicionar comando
          </Button>
          <Button variant="light" size="xs" leftSection={<IconPlus size={14} />} onClick={() => addAction('script')}>
            Adicionar script
          </Button>
        </Group>

        <Divider label="Agendamento" labelPosition="left" />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Select
            label="Quando executar"
            allowDeselect={false}
            data={SCHEDULE_OPTIONS}
            value={type}
            onChange={(v) => isSchedule(v) && form.setFieldValue('scheduleType', v)}
          />
          {type === 'once' && (
            <DateTimePicker
              label="Data e hora"
              required
              valueFormat="DD/MM/YYYY HH:mm"
              minDate={dayjs().format('YYYY-MM-DD HH:mm:ss')}
              {...form.getInputProps('runAt')}
            />
          )}
          {(type === 'daily' || type === 'weekly' || type === 'monthly') && (
            <TimeInput label="Horário" required description="No fuso horário das configurações gerais" {...form.getInputProps('time')} />
          )}
          {type === 'check_failure' && (
            <Select
              label="Check"
              required
              searchable
              data={checkOptions}
              nothingFoundMessage="Nenhum check disponível"
              {...form.getInputProps('assignedCheckId')}
            />
          )}
        </SimpleGrid>
        {type === 'weekly' && (
          <Input.Wrapper label="Dias da semana" required error={form.errors.daysOfWeek}>
            <Chip.Group multiple value={values.daysOfWeek} onChange={(v) => form.setFieldValue('daysOfWeek', v)}>
              <Group gap={6} mt={6}>
                {WEEKDAYS.map((d) => (
                  <Chip key={d.value} value={String(d.value)} size="sm" aria-label={d.long}>
                    {d.short}
                  </Chip>
                ))}
              </Group>
            </Chip.Group>
          </Input.Wrapper>
        )}
        {type === 'monthly' && (
          <NumberInput label="Dia do mês" min={1} max={31} allowDecimal={false} w={160} {...form.getInputProps('dayOfMonth')} />
        )}
        <Alert color="blue" variant="light" icon={<IconInfoCircle size={18} />}>
          {describeSchedule(preview, checkLabel)}
        </Alert>

        <Divider label="Alertas" labelPosition="left" />
        <Group gap="xl">
          <Switch label="Alertar por e-mail" {...form.getInputProps('emailAlert', { type: 'checkbox' })} />
          <Switch label="Alertar por webhook" {...form.getInputProps('webhookAlert', { type: 'checkbox' })} />
          <Switch label="Mostrar no painel" {...form.getInputProps('dashboardAlert', { type: 'checkbox' })} />
        </Group>

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            {current ? 'Salvar' : 'Criar tarefa'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
