import { NumberInput, Select, SimpleGrid, Switch, TextInput } from '@mantine/core';
import { DatePickerInput, type DatesRangeValue } from '@mantine/dates';
import { IconCalendar } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { reportsApi } from '../../api/reports';
import { queryKeys } from '../../api/queryKeys';
import { PERMISSIONS, type ReportTypeDto } from '../../api/types';
import { hasPermission } from '../../auth/permissions';
import { useMe } from '../../auth/useMe';
import { siteSelectGroups, useClients } from '../clients/useClients';
import { ASSET_TYPE_OPTIONS } from '../inventory/inventoryFormat';
import { SEVERITY_OPTIONS } from '../monitoring/monitoringFormat';
import {
  hasFilter,
  isPeriodChoice,
  MAX_REPORT_RANGE_DAYS,
  PERIOD_CHOICE_OPTIONS,
  PERIOD_OPTIONS,
  statusOptionsFor,
  type ReportFilterValues,
} from './reportFormat';

interface ReportFiltersProps {
  def: ReportTypeDto;
  values: ReportFilterValues;
  onChange: (patch: Partial<ReportFilterValues>) => void;
  /** Agendamentos aceitam so periodos relativos (sem intervalo personalizado). */
  relativeOnly?: boolean;
  /** Erro do periodo (intervalo invalido ou ausente). */
  periodError?: string;
  /** Prefixo dos ids para nao repetir ids quando ha dois formularios na tela. */
  idPrefix: string;
}

export function ReportFilters({ def, values, onChange, relativeOnly = false, periodError, idPrefix }: ReportFiltersProps) {
  const { data: me } = useMe();
  const usesClient = hasFilter(def, 'clientId');
  const usesSite = hasFilter(def, 'siteId');
  const usesAssignee = hasFilter(def, 'assignedToId');
  const clients = useClients((usesClient || usesSite) && hasPermission(me, PERMISSIONS.clientsView));
  const assignees = useQuery({ queryKey: queryKeys.ticketAssignees, queryFn: reportsApi.assignees, enabled: usesAssignee, retry: false });

  const clientList = clients.data ?? [];
  const sitesSource = values.clientId ? clientList.filter((c) => String(c.id) === values.clientId) : clientList;
  const statusOptions = statusOptionsFor(def.type);

  return (
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
      {def.usesPeriod && (
        <Select
          id={`${idPrefix}-period`}
          label="Período"
          required={relativeOnly}
          allowDeselect={false}
          data={relativeOnly ? PERIOD_OPTIONS : PERIOD_CHOICE_OPTIONS}
          value={values.period}
          error={relativeOnly ? periodError : undefined}
          onChange={(v) => {
            if (isPeriodChoice(v) && (!relativeOnly || v !== 'custom')) onChange({ period: v });
          }}
        />
      )}
      {def.usesPeriod && !relativeOnly && values.period === 'custom' && (
        <DatePickerInput
          id={`${idPrefix}-range`}
          type="range"
          label="Intervalo"
          placeholder="Escolha as datas"
          valueFormat="DD/MM/YYYY"
          leftSection={<IconCalendar size={16} />}
          allowSingleDateInRange
          maxDate={dayjs().format('YYYY-MM-DD')}
          value={values.range}
          onChange={(value: DatesRangeValue<string>) => onChange({ range: [value[0], value[1]] })}
          error={periodError}
          description={`Até ${MAX_REPORT_RANGE_DAYS} dias`}
        />
      )}
      {usesClient && clients.data && (
        <Select
          id={`${idPrefix}-client`}
          label="Cliente"
          placeholder="Todos os clientes"
          clearable
          searchable
          data={clientList.map((c) => ({ value: String(c.id), label: c.name }))}
          value={values.clientId}
          onChange={(v) => onChange({ clientId: v, siteId: null })}
        />
      )}
      {usesSite && clients.data && (
        <Select
          id={`${idPrefix}-site`}
          label="Site"
          placeholder="Todos os sites"
          clearable
          searchable
          data={siteSelectGroups(sitesSource)}
          value={values.siteId}
          onChange={(v) => onChange({ siteId: v })}
        />
      )}
      {hasFilter(def, 'status') &&
        (statusOptions ? (
          <Select
            id={`${idPrefix}-status`}
            label="Status"
            placeholder="Todos"
            clearable
            data={statusOptions}
            value={values.status}
            onChange={(v) => onChange({ status: v })}
          />
        ) : (
          <TextInput
            id={`${idPrefix}-status`}
            label="Status"
            placeholder="Todos"
            value={values.status ?? ''}
            onChange={(e) => onChange({ status: e.currentTarget.value || null })}
          />
        ))}
      {hasFilter(def, 'severity') && (
        <Select
          id={`${idPrefix}-severity`}
          label="Severidade"
          placeholder="Todas"
          clearable
          data={SEVERITY_OPTIONS}
          value={values.severity}
          onChange={(v) => onChange({ severity: v })}
        />
      )}
      {usesAssignee && (
        <Select
          id={`${idPrefix}-assignee`}
          label="Técnico"
          placeholder="Todos os técnicos"
          clearable
          searchable
          data={(assignees.data ?? []).map((a) => ({ value: a.id, label: a.name }))}
          value={values.assignedToId}
          disabled={assignees.isError}
          description={assignees.isError ? 'Não foi possível carregar os técnicos.' : undefined}
          onChange={(v) => onChange({ assignedToId: v })}
        />
      )}
      {hasFilter(def, 'assetType') && (
        <Select
          id={`${idPrefix}-asset-type`}
          label="Tipo de ativo"
          placeholder="Todos os tipos"
          clearable
          data={ASSET_TYPE_OPTIONS}
          value={values.assetType}
          onChange={(v) => onChange({ assetType: v })}
        />
      )}
      {hasFilter(def, 'maxScore') && (
        <NumberInput
          id={`${idPrefix}-max-score`}
          label="Nota máxima"
          description="Mostra só as máquinas com nota até este valor"
          placeholder="Qualquer nota"
          min={0}
          max={100}
          allowDecimal={false}
          value={values.maxScore}
          onChange={(v) => onChange({ maxScore: v })}
        />
      )}
      {hasFilter(def, 'onlyPending') && (
        <Switch
          id={`${idPrefix}-only-pending`}
          label="Somente pendentes"
          mt="xl"
          checked={values.onlyPending}
          onChange={(e) => onChange({ onlyPending: e.currentTarget.checked })}
        />
      )}
    </SimpleGrid>
  );
}
