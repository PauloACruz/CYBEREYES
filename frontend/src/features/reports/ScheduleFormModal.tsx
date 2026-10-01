import { Button, Group, Modal, NumberInput, SegmentedControl, Select, SimpleGrid, Stack, Switch, TagsInput, Text, TextInput } from '@mantine/core';
import { TimeInput } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { reportsApi } from '../../api/reports';
import { queryKeys } from '../../api/queryKeys';
import type { ReportScheduleDto, ReportTypeDto, SaveReportSchedule } from '../../api/types';
import { notifySuccess } from '../../lib/feedback';
import { applyServerErrors } from '../../lib/forms';
import { WEEKDAYS } from '../monitoring/monitoringFormat';
import { ReportFilters } from './ReportFilters';
import { FREQUENCY_OPTIONS, isReportFormat, isReportFrequency, type ReportFilterValues } from './reportFormat';
import { initialScheduleValues, MAX_RECIPIENTS, toSaveSchedule, validateSchedule, type ScheduleFormValues } from './scheduleForm';

interface ScheduleFormModalProps {
  opened: boolean;
  schedule: ReportScheduleDto | null;
  types: ReportTypeDto[];
  onClose: () => void;
}

export function ScheduleFormModal({ opened, schedule, types, onClose }: ScheduleFormModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} title={schedule ? 'Editar agendamento' : 'Novo agendamento'} size="xl" centered>
      {opened && <ScheduleForm key={schedule?.id ?? 'novo'} schedule={schedule} types={types} onClose={onClose} />}
    </Modal>
  );
}

const WEEKDAY_OPTIONS = WEEKDAYS.map((d) => ({ value: String(d.value), label: d.long }));

function ScheduleForm({ schedule, types, onClose }: { schedule: ReportScheduleDto | null; types: ReportTypeDto[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const form = useForm<ScheduleFormValues>({
    initialValues: initialScheduleValues(schedule, types[0]?.type ?? ''),
    validate: (values) => validateSchedule(values, types.find((t) => t.type === values.type)),
  });
  const def = types.find((t) => t.type === form.values.type);

  const save = useMutation({
    mutationFn: (body: SaveReportSchedule) => (schedule ? reportsApi.updateSchedule(schedule.id, body) : reportsApi.createSchedule(body)),
    onSuccess: async () => {
      notifySuccess(schedule ? 'Agendamento atualizado.' : 'Agendamento criado.');
      await queryClient.invalidateQueries({ queryKey: queryKeys.reportSchedules });
      onClose();
    },
    onError: (error) => applyServerErrors(form, error),
  });

  const changeFilters = (patch: Partial<ReportFilterValues>) => {
    form.setFieldValue('filters', { ...form.values.filters, ...patch });
    if ('period' in patch) form.clearFieldError('filters.period');
  };

  return (
    <form
      onSubmit={form.onSubmit((values) => {
        const selected = types.find((t) => t.type === values.type);
        if (selected) save.mutate(toSaveSchedule(values, selected));
      })}
      noValidate
    >
      <Stack>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label="Nome" required maxLength={200} data-autofocus {...form.getInputProps('name')} />
          <Select
            label="Tipo de relatório"
            required
            allowDeselect={false}
            data={types.map((t) => ({ value: t.type, label: t.label }))}
            {...form.getInputProps('type')}
          />
        </SimpleGrid>
        {def && (
          <ReportFilters
            def={def}
            values={form.values.filters}
            onChange={changeFilters}
            relativeOnly
            periodError={typeof form.errors['filters.period'] === 'string' ? form.errors['filters.period'] : undefined}
            idPrefix="schedule"
          />
        )}
        <div>
          <Text size="sm" fw={500} mb={4} id="schedule-format-label">
            Formato
          </Text>
          <SegmentedControl
            aria-labelledby="schedule-format-label"
            data={[
              { value: 'pdf', label: 'PDF' },
              { value: 'csv', label: 'CSV' },
            ]}
            value={form.values.format}
            onChange={(v) => isReportFormat(v) && form.setFieldValue('format', v)}
          />
        </div>
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <Select
            label="Frequência"
            required
            allowDeselect={false}
            data={FREQUENCY_OPTIONS}
            value={form.values.frequency}
            onChange={(v) => isReportFrequency(v) && form.setFieldValue('frequency', v)}
          />
          <TimeInput label="Hora" required description="No fuso horário das configurações gerais" {...form.getInputProps('time')} />
          {form.values.frequency === 'weekly' && (
            <Select label="Dia da semana" required allowDeselect={false} data={WEEKDAY_OPTIONS} {...form.getInputProps('dayOfWeek')} />
          )}
          {form.values.frequency === 'monthly' && (
            <NumberInput label="Dia do mês" required min={1} max={28} allowDecimal={false} description="De 1 a 28" {...form.getInputProps('dayOfMonth')} />
          )}
        </SimpleGrid>
        <TagsInput
          label="Destinatários"
          required
          description={`E-mails que recebem o arquivo anexo (até ${MAX_RECIPIENTS}). Digite e tecle Enter.`}
          placeholder="nome@empresa.com.br"
          splitChars={[',', ';', ' ']}
          maxTags={MAX_RECIPIENTS}
          clearable
          {...form.getInputProps('recipients')}
        />
        <Switch label="Agendamento ativo" {...form.getInputProps('enabled', { type: 'checkbox' })} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            {schedule ? 'Salvar' : 'Criar agendamento'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
