import type { CheckDto, CheckType, EventLogName, EventType, FailWhen, SaveCheckRequest, Severity } from '../../../api/types';

export interface CheckOwner {
  agentId: number | null;
  policyId: number | null;
}

export const CHECK_TYPE_LABEL: Record<CheckType, string> = {
  diskspace: 'Espaço em disco',
  cpuload: 'Carga de CPU',
  memory: 'Memória',
  ping: 'Ping',
  script: 'Script',
  winsvc: 'Serviço do Windows',
  eventlog: 'Event Log do Windows',
};

export const WINDOWS_ONLY_TYPES: ReadonlySet<CheckType> = new Set<CheckType>(['winsvc', 'eventlog']);

export function checkTypeOptions(windowsAllowed: boolean): { value: CheckType; label: string }[] {
  return (Object.keys(CHECK_TYPE_LABEL) as CheckType[])
    .filter((type) => windowsAllowed || !WINDOWS_ONLY_TYPES.has(type))
    .map((value) => ({ value, label: WINDOWS_ONLY_TYPES.has(value) ? `${CHECK_TYPE_LABEL[value]} (só Windows)` : CHECK_TYPE_LABEL[value] }));
}

export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  INFO: 'Informação',
  WARNING: 'Aviso',
  ERROR: 'Erro',
  AUDIT_SUCCESS: 'Auditoria com êxito',
  AUDIT_FAILURE: 'Falha de auditoria',
};

export const EVENT_LOGS: readonly EventLogName[] = ['Application', 'System', 'Security'];

/** Nome exibido: o nome dado pelo usuario ou uma descricao gerada pelo tipo. */
export function checkDisplayName(check: CheckDto, scriptName?: string): string {
  if (check.name.trim()) return check.name;
  switch (check.checkType) {
    case 'diskspace':
      return `Espaço em disco ${check.disk ?? ''}`.trim();
    case 'cpuload':
      return 'Carga de CPU';
    case 'memory':
      return 'Uso de memória';
    case 'ping':
      return `Ping ${check.ip ?? ''}`.trim();
    case 'script':
      return `Script ${scriptName ?? (check.scriptId !== null ? `#${check.scriptId}` : '')}`.trim();
    case 'winsvc':
      return `Serviço ${check.svcName ?? ''}`.trim();
    case 'eventlog':
      return `Event Log ${check.logName ?? ''}`.trim();
  }
}

/** Valores do formulario; codigos de retorno ficam como texto ate o envio. */
export interface CheckFormValues {
  checkType: CheckType;
  name: string;
  runInterval: number;
  failsBeforeAlert: number;
  alertSeverity: Severity;
  warningThreshold: number;
  errorThreshold: number;
  disk: string;
  ip: string;
  scriptId: string | null;
  scriptArgs: string[];
  envVars: string[];
  timeout: number;
  infoReturnCodes: string[];
  warningReturnCodes: string[];
  successReturnCodes: string[];
  svcName: string;
  passIfStartPending: boolean;
  passIfSvcNotExist: boolean;
  restartIfStopped: boolean;
  logName: EventLogName;
  eventId: number | string;
  eventIdIsWildcard: boolean;
  eventType: EventType;
  eventSource: string;
  eventMessage: string;
  failWhen: FailWhen;
  searchLastDays: number;
  numberOfEventsBeforeAlert: number;
  emailAlert: boolean;
  webhookAlert: boolean;
  dashboardAlert: boolean;
}

const DEFAULT_THRESHOLDS: Record<CheckType, { warning: number; error: number }> = {
  diskspace: { warning: 25, error: 10 },
  cpuload: { warning: 85, error: 95 },
  memory: { warning: 85, error: 95 },
  ping: { warning: 0, error: 0 },
  script: { warning: 0, error: 0 },
  winsvc: { warning: 0, error: 0 },
  eventlog: { warning: 0, error: 0 },
};

export function defaultCheckValues(checkType: CheckType = 'diskspace'): CheckFormValues {
  return {
    checkType,
    name: '',
    runInterval: 0,
    failsBeforeAlert: 1,
    alertSeverity: 'warning',
    warningThreshold: DEFAULT_THRESHOLDS[checkType].warning,
    errorThreshold: DEFAULT_THRESHOLDS[checkType].error,
    disk: '',
    ip: '',
    scriptId: null,
    scriptArgs: [],
    envVars: [],
    timeout: 120,
    infoReturnCodes: [],
    warningReturnCodes: [],
    successReturnCodes: [],
    svcName: '',
    passIfStartPending: false,
    passIfSvcNotExist: false,
    restartIfStopped: false,
    logName: 'Application',
    eventId: '',
    eventIdIsWildcard: false,
    eventType: 'ERROR',
    eventSource: '',
    eventMessage: '',
    failWhen: 'contains',
    searchLastDays: 1,
    numberOfEventsBeforeAlert: 1,
    emailAlert: false,
    webhookAlert: false,
    dashboardAlert: true,
  };
}

/** Ao trocar o tipo, os limites voltam ao padrao do novo tipo. */
export function changeCheckType(values: CheckFormValues, checkType: CheckType): CheckFormValues {
  return {
    ...values,
    checkType,
    warningThreshold: DEFAULT_THRESHOLDS[checkType].warning,
    errorThreshold: DEFAULT_THRESHOLDS[checkType].error,
  };
}

export function checkToValues(check: CheckDto): CheckFormValues {
  const base = defaultCheckValues(check.checkType);
  return {
    ...base,
    checkType: check.checkType,
    name: check.name,
    runInterval: check.runInterval,
    failsBeforeAlert: check.failsBeforeAlert,
    alertSeverity: check.alertSeverity,
    warningThreshold: check.warningThreshold,
    errorThreshold: check.errorThreshold,
    disk: check.disk ?? '',
    ip: check.ip ?? '',
    scriptId: check.scriptId !== null ? String(check.scriptId) : null,
    scriptArgs: [...check.scriptArgs],
    envVars: [...check.envVars],
    timeout: check.timeout ?? base.timeout,
    infoReturnCodes: check.infoReturnCodes.map(String),
    warningReturnCodes: check.warningReturnCodes.map(String),
    successReturnCodes: check.successReturnCodes.map(String),
    svcName: check.svcName ?? '',
    passIfStartPending: check.passIfStartPending,
    passIfSvcNotExist: check.passIfSvcNotExist,
    restartIfStopped: check.restartIfStopped,
    logName: check.logName ?? base.logName,
    eventId: check.eventId ?? '',
    eventIdIsWildcard: check.eventIdIsWildcard,
    eventType: check.eventType ?? base.eventType,
    eventSource: check.eventSource ?? '',
    eventMessage: check.eventMessage ?? '',
    failWhen: check.failWhen,
    searchLastDays: check.searchLastDays,
    numberOfEventsBeforeAlert: check.numberOfEventsBeforeAlert,
    emailAlert: check.emailAlert,
    webhookAlert: check.webhookAlert,
    dashboardAlert: check.dashboardAlert,
  };
}

export function isReturnCode(value: string): boolean {
  return /^-?\d+$/.test(value.trim());
}

function codes(values: string[]): number[] {
  return values.filter(isReturnCode).map((v) => Number.parseInt(v, 10));
}

function textOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

const usesThresholds = (type: CheckType) => type === 'diskspace' || type === 'cpuload' || type === 'memory';

/** Monta o corpo de POST/PUT /api/checks; campos de outros tipos vao vazios. */
export function buildCheckBody(values: CheckFormValues, owner: CheckOwner): SaveCheckRequest {
  const type = values.checkType;
  const isScript = type === 'script';
  const isService = type === 'winsvc';
  const isEventLog = type === 'eventlog';
  return {
    agentId: owner.agentId,
    policyId: owner.policyId,
    checkType: type,
    name: values.name.trim(),
    runInterval: values.runInterval,
    failsBeforeAlert: values.failsBeforeAlert,
    alertSeverity: values.alertSeverity,
    warningThreshold: usesThresholds(type) ? values.warningThreshold : 0,
    errorThreshold: usesThresholds(type) ? values.errorThreshold : 0,
    disk: type === 'diskspace' ? textOrNull(values.disk) : null,
    ip: type === 'ping' ? textOrNull(values.ip) : null,
    scriptId: isScript && values.scriptId ? Number(values.scriptId) : null,
    scriptArgs: isScript ? values.scriptArgs.filter((a) => a.trim() !== '') : [],
    envVars: isScript ? values.envVars.filter((v) => v.trim() !== '') : [],
    timeout: isScript ? values.timeout : null,
    infoReturnCodes: isScript ? codes(values.infoReturnCodes) : [],
    warningReturnCodes: isScript ? codes(values.warningReturnCodes) : [],
    successReturnCodes: isScript ? codes(values.successReturnCodes) : [],
    svcName: isService ? textOrNull(values.svcName) : null,
    passIfStartPending: isService && values.passIfStartPending,
    passIfSvcNotExist: isService && values.passIfSvcNotExist,
    restartIfStopped: isService && values.restartIfStopped,
    logName: isEventLog ? values.logName : null,
    eventId: isEventLog && !values.eventIdIsWildcard && typeof values.eventId === 'number' ? values.eventId : null,
    eventIdIsWildcard: isEventLog && values.eventIdIsWildcard,
    eventType: isEventLog ? values.eventType : null,
    eventSource: isEventLog ? textOrNull(values.eventSource) : null,
    eventMessage: isEventLog ? textOrNull(values.eventMessage) : null,
    failWhen: values.failWhen,
    searchLastDays: values.searchLastDays,
    numberOfEventsBeforeAlert: values.numberOfEventsBeforeAlert,
    emailAlert: values.emailAlert,
    webhookAlert: values.webhookAlert,
    dashboardAlert: values.dashboardAlert,
  };
}

/** Validacao por tipo; devolve erros por campo do formulario. */
export function validateCheck(values: CheckFormValues): Partial<Record<keyof CheckFormValues, string>> {
  const errors: Partial<Record<keyof CheckFormValues, string>> = {};
  const { checkType: type, warningThreshold: warning, errorThreshold: error } = values;
  if (!Number.isInteger(values.failsBeforeAlert) || values.failsBeforeAlert < 1 || values.failsBeforeAlert > 100) {
    errors.failsBeforeAlert = 'Entre 1 e 100';
  }
  if (!Number.isInteger(values.runInterval) || values.runInterval < 0 || values.runInterval > 86400) {
    errors.runInterval = 'Entre 0 e 86400 segundos';
  }
  if (usesThresholds(type)) {
    if (warning < 0 || warning > 99) errors.warningThreshold = 'Entre 0 e 99';
    if (error < 0 || error > 99) errors.errorThreshold = 'Entre 0 e 99';
    if (warning === 0 && error === 0) errors.errorThreshold = 'Defina ao menos um limite';
    else if (warning > 0 && error > 0) {
      if (type === 'diskspace' && warning <= error) errors.warningThreshold = 'O aviso deve ser maior que o limite de erro (espaço livre)';
      if (type !== 'diskspace' && warning >= error) errors.warningThreshold = 'O aviso deve ser menor que o limite de erro';
    }
  }
  if (type === 'diskspace' && !values.disk.trim()) errors.disk = 'Informe o disco (ex.: C: ou /)';
  if (type === 'ping' && !values.ip.trim()) errors.ip = 'Informe o endereço a testar';
  if (type === 'script') {
    if (!values.scriptId) errors.scriptId = 'Escolha o script';
    if (!Number.isInteger(values.timeout) || values.timeout < 1 || values.timeout > 86400) errors.timeout = 'Entre 1 e 86400 segundos';
    const allCodes = [...values.infoReturnCodes, ...values.warningReturnCodes, ...values.successReturnCodes];
    if (allCodes.some((c) => !isReturnCode(c))) errors.successReturnCodes = 'Use somente números inteiros nos códigos de retorno';
  }
  if (type === 'winsvc' && !values.svcName.trim()) errors.svcName = 'Informe o nome do serviço';
  if (type === 'eventlog') {
    if (!values.eventIdIsWildcard && typeof values.eventId !== 'number') errors.eventId = 'Informe o ID do evento ou marque qualquer ID';
    if (values.searchLastDays < 1 || values.searchLastDays > 365) errors.searchLastDays = 'Entre 1 e 365 dias';
    if (values.numberOfEventsBeforeAlert < 1) errors.numberOfEventsBeforeAlert = 'Mínimo 1';
  }
  return errors;
}
