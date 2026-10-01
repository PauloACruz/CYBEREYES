import dayjs from 'dayjs';
import type { CommandShell, SaveTaskRequest, Severity, TaskAction, TaskDto, TaskScheduleType } from '../../../api/types';
import type { CheckOwner } from '../checks/checkForm';

export const SCHEDULE_OPTIONS: { value: TaskScheduleType; label: string }[] = [
  { value: 'manual', label: 'Manual' },
  { value: 'once', label: 'Uma vez' },
  { value: 'daily', label: 'Diária' },
  { value: 'weekly', label: 'Semanal' },
  { value: 'monthly', label: 'Mensal' },
  { value: 'check_failure', label: 'Ao falhar um check' },
];

export const ALL_SHELLS: { value: CommandShell; label: string }[] = [
  { value: 'cmd', label: 'cmd (Windows)' },
  { value: 'powershell', label: 'PowerShell (Windows)' },
  { value: '/bin/bash', label: '/bin/bash' },
  { value: '/bin/sh', label: '/bin/sh' },
  { value: '/bin/zsh', label: '/bin/zsh' },
];

export interface ActionDraft {
  key: number;
  type: 'cmd' | 'script';
  command: string;
  shell: CommandShell;
  scriptId: string | null;
  args: string[];
  envVars: string[];
  timeout: number;
  runAsUser: boolean;
}

export interface TaskFormValues {
  name: string;
  enabled: boolean;
  continueOnError: boolean;
  alertSeverity: Severity;
  actions: ActionDraft[];
  scheduleType: TaskScheduleType;
  /** "YYYY-MM-DD HH:mm:ss" (formato do DateTimePicker). */
  runAt: string | null;
  time: string;
  daysOfWeek: string[];
  dayOfMonth: number | string;
  assignedCheckId: string | null;
  emailAlert: boolean;
  webhookAlert: boolean;
  dashboardAlert: boolean;
}

let nextKey = 1;
const newKey = () => nextKey++;

export function newAction(type: 'cmd' | 'script', shell: CommandShell): ActionDraft {
  return { key: newKey(), type, command: '', shell, scriptId: null, args: [], envVars: [], timeout: 300, runAsUser: false };
}

function actionToDraft(action: TaskAction): ActionDraft {
  if (action.type === 'cmd') {
    return { ...newAction('cmd', action.shell), command: action.command, timeout: action.timeout };
  }
  return {
    ...newAction('script', 'cmd'),
    scriptId: String(action.scriptId),
    args: [...action.args],
    envVars: [...action.envVars],
    timeout: action.timeout,
    runAsUser: action.runAsUser,
  };
}

export function defaultTaskValues(): TaskFormValues {
  return {
    name: '',
    enabled: true,
    continueOnError: true,
    alertSeverity: 'warning',
    actions: [],
    scheduleType: 'manual',
    runAt: null,
    time: '08:00',
    daysOfWeek: ['1'],
    dayOfMonth: 1,
    assignedCheckId: null,
    emailAlert: false,
    webhookAlert: false,
    dashboardAlert: true,
  };
}

export function taskToValues(task: TaskDto): TaskFormValues {
  const base = defaultTaskValues();
  return {
    name: task.name,
    enabled: task.enabled,
    continueOnError: task.continueOnError,
    alertSeverity: task.alertSeverity,
    actions: task.actions.map(actionToDraft),
    scheduleType: task.scheduleType,
    runAt: task.runAt ? dayjs(task.runAt).format('YYYY-MM-DD HH:mm:ss') : null,
    time: task.time ?? base.time,
    daysOfWeek: task.daysOfWeek.length ? task.daysOfWeek.map(String) : base.daysOfWeek,
    dayOfMonth: task.dayOfMonth ?? base.dayOfMonth,
    assignedCheckId: task.assignedCheckId !== null ? String(task.assignedCheckId) : null,
    emailAlert: task.emailAlert,
    webhookAlert: task.webhookAlert,
    dashboardAlert: task.dashboardAlert,
  };
}

function draftToAction(draft: ActionDraft): TaskAction {
  if (draft.type === 'cmd') {
    return { type: 'cmd', command: draft.command.trim(), shell: draft.shell, timeout: draft.timeout };
  }
  return {
    type: 'script',
    scriptId: Number(draft.scriptId),
    args: draft.args.filter((a) => a.trim() !== ''),
    envVars: draft.envVars.filter((v) => v.trim() !== ''),
    timeout: draft.timeout,
    runAsUser: draft.runAsUser,
  };
}

export function buildTaskBody(values: TaskFormValues, owner: CheckOwner): SaveTaskRequest {
  const type = values.scheduleType;
  const timed = type === 'daily' || type === 'weekly' || type === 'monthly';
  return {
    agentId: owner.agentId,
    policyId: owner.policyId,
    name: values.name.trim(),
    enabled: values.enabled,
    continueOnError: values.continueOnError,
    alertSeverity: values.alertSeverity,
    actions: values.actions.map(draftToAction),
    scheduleType: type,
    runAt: type === 'once' && values.runAt ? dayjs(values.runAt).toISOString() : null,
    time: timed ? values.time : null,
    daysOfWeek: type === 'weekly' ? values.daysOfWeek.map(Number).sort((a, b) => a - b) : [],
    dayOfMonth: type === 'monthly' && typeof values.dayOfMonth === 'number' ? values.dayOfMonth : null,
    assignedCheckId: type === 'check_failure' && values.assignedCheckId ? Number(values.assignedCheckId) : null,
    emailAlert: values.emailAlert,
    webhookAlert: values.webhookAlert,
    dashboardAlert: values.dashboardAlert,
  };
}

export function validateTask(values: TaskFormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!values.name.trim()) errors.name = 'Informe o nome';
  if (values.actions.length === 0) errors.actions = 'Inclua ao menos uma ação';
  values.actions.forEach((action, i) => {
    if (action.type === 'cmd' && !action.command.trim()) errors[`actions.${i}.command`] = 'Informe o comando';
    if (action.type === 'script' && !action.scriptId) errors[`actions.${i}.scriptId`] = 'Escolha o script';
    if (!Number.isInteger(action.timeout) || action.timeout < 5 || action.timeout > 86400) {
      errors[`actions.${i}.timeout`] = 'Entre 5 e 86400 segundos';
    }
  });
  const type = values.scheduleType;
  if (type === 'once' && (!values.runAt || !dayjs(values.runAt).isAfter(dayjs()))) errors.runAt = 'Escolha uma data futura';
  if ((type === 'daily' || type === 'weekly' || type === 'monthly') && !/^([01]\d|2[0-3]):[0-5]\d$/.test(values.time)) {
    errors.time = 'Informe o horário (HH:mm)';
  }
  if (type === 'weekly' && values.daysOfWeek.length === 0) errors.daysOfWeek = 'Escolha ao menos um dia';
  if (type === 'monthly' && (typeof values.dayOfMonth !== 'number' || values.dayOfMonth < 1 || values.dayOfMonth > 31)) {
    errors.dayOfMonth = 'Entre 1 e 31';
  }
  if (type === 'check_failure' && !values.assignedCheckId) errors.assignedCheckId = 'Escolha o check';
  return errors;
}

export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (moved !== undefined) next.splice(to, 0, moved);
  return next;
}
