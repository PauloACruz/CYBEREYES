import type { ReportFormat, ReportFrequency, ReportScheduleDto, ReportTypeDto, SaveReportSchedule } from '../../api/types';
import { buildReportParams, DEFAULT_PERIOD, EMPTY_FILTERS, filtersFromParams, isReportPeriod, type ReportFilterValues } from './reportFormat';

export const MAX_RECIPIENTS = 20;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface ScheduleFormValues {
  name: string;
  type: string;
  filters: ReportFilterValues;
  format: ReportFormat;
  frequency: ReportFrequency;
  time: string;
  dayOfWeek: string;
  dayOfMonth: number | string;
  recipients: string[];
  enabled: boolean;
}

export function initialScheduleValues(schedule: ReportScheduleDto | null, defaultType: string): ScheduleFormValues {
  if (!schedule) {
    return {
      name: '',
      type: defaultType,
      filters: { ...EMPTY_FILTERS, period: DEFAULT_PERIOD },
      format: 'pdf',
      frequency: 'weekly',
      time: '08:00',
      dayOfWeek: '1',
      dayOfMonth: 1,
      recipients: [],
      enabled: true,
    };
  }
  return {
    name: schedule.name,
    type: schedule.params.type,
    filters: filtersFromParams(schedule.params),
    format: schedule.format,
    frequency: schedule.frequency,
    time: schedule.time.slice(0, 5),
    dayOfWeek: String(schedule.dayOfWeek ?? 1),
    dayOfMonth: schedule.dayOfMonth ?? 1,
    recipients: schedule.recipients,
    enabled: schedule.enabled,
  };
}

/** Mesmas regras do SaveReportSchedule do contrato; chaves no formato do useForm. */
export function validateSchedule(values: ScheduleFormValues, def: ReportTypeDto | undefined): Record<string, string> {
  const errors: Record<string, string> = {};
  const name = values.name.trim();
  if (!name) errors.name = 'Informe o nome';
  else if (name.length > 200) errors.name = 'Use no máximo 200 caracteres';

  if (!def) errors.type = 'Escolha o tipo de relatório';
  else if (def.usesPeriod && !isReportPeriod(values.filters.period)) errors['filters.period'] = 'Escolha um período relativo';

  if (!TIME_RE.test(values.time)) errors.time = 'Informe o horário no formato HH:mm';

  if (values.frequency === 'weekly') {
    const day = Number(values.dayOfWeek);
    if (values.dayOfWeek === '' || !Number.isInteger(day) || day < 0 || day > 6) errors.dayOfWeek = 'Escolha o dia da semana';
  }
  if (values.frequency === 'monthly') {
    const day = Number(values.dayOfMonth);
    if (values.dayOfMonth === '' || !Number.isInteger(day) || day < 1 || day > 28) errors.dayOfMonth = 'Escolha um dia entre 1 e 28';
  }

  const recipients = values.recipients.map((r) => r.trim()).filter(Boolean);
  const invalid = recipients.filter((r) => !EMAIL_RE.test(r));
  if (recipients.length === 0) errors.recipients = 'Informe ao menos um destinatário';
  else if (recipients.length > MAX_RECIPIENTS) errors.recipients = `Informe no máximo ${MAX_RECIPIENTS} destinatários`;
  else if (invalid.length > 0) errors.recipients = `E-mail inválido: ${invalid.join(', ')}`;

  return errors;
}

export function toSaveSchedule(values: ScheduleFormValues, def: ReportTypeDto): SaveReportSchedule {
  // Periodo relativo garantido pela validacao: o agendamento nunca envia from/to.
  const params = buildReportParams(def, values.filters.period === 'custom' ? { ...values.filters, period: DEFAULT_PERIOD } : values.filters).params;
  return {
    name: values.name.trim(),
    params,
    format: values.format,
    frequency: values.frequency,
    time: values.time,
    dayOfWeek: values.frequency === 'weekly' ? Number(values.dayOfWeek) : null,
    dayOfMonth: values.frequency === 'monthly' ? Number(values.dayOfMonth) : null,
    recipients: values.recipients.map((r) => r.trim()).filter(Boolean),
    enabled: values.enabled,
  };
}
