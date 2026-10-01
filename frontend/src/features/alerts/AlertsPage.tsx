import { useState } from 'react';
import { Button, Group, Modal, Pagination, Paper, SegmentedControl, Select, Stack, Text } from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { IconBellOff, IconCheck, IconTemplate } from '@tabler/icons-react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Link, useSearchParams } from 'react-router';
import { alertsApi } from '../../api/alerts';
import { queryKeys } from '../../api/queryKeys';
import { PERMISSIONS, type BulkAlertRequest, type ListAlertsParams } from '../../api/types';
import { PATHS } from '../../app/paths';
import { hasPermission } from '../../auth/permissions';
import { useMe } from '../../auth/useMe';
import { PageHeader } from '../../components/PageHeader';
import { LoadError } from '../../components/TableStates';
import { notifySuccess } from '../../lib/feedback';
import { totalPages } from '../../lib/format';
import { useClients } from '../clients/useClients';
import { isSeverity, SEVERITY_OPTIONS } from '../monitoring/monitoringFormat';
import { isStatusFilter, STATUS_FILTER_OPTIONS } from './alertFormat';
import { AlertsTable } from './AlertsTable';

const PAGE_SIZE = 50;

function toId(value: string | null): number | undefined {
  if (!value) return undefined;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

export function AlertsPage() {
  const { data: me } = useMe();
  const canManage = hasPermission(me, PERMISSIONS.alertsManage);
  const queryClient = useQueryClient();
  const clients = useClients(hasPermission(me, PERMISSIONS.clientsView));
  const [searchParams, setSearchParams] = useSearchParams();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [snoozeOpened, setSnoozeOpened] = useState(false);

  const statusParam = searchParams.get('status');
  const severityParam = searchParams.get('severidade');
  const params: ListAlertsParams = {
    status: isStatusFilter(statusParam) ? statusParam : 'active',
    severity: isSeverity(severityParam) ? severityParam : undefined,
    clientId: toId(searchParams.get('cliente')),
    page: toId(searchParams.get('pagina')) ?? 1,
    pageSize: PAGE_SIZE,
  };

  const updateParams = (changes: Record<string, string | undefined>) => {
    setSelected(new Set());
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        if (!('pagina' in changes)) next.delete('pagina');
        return next;
      },
      { replace: true },
    );
  };

  const alerts = useQuery({
    queryKey: queryKeys.alertList(params),
    queryFn: () => alertsApi.list(params),
    placeholderData: keepPreviousData,
  });

  const bulk = useMutation({
    mutationFn: (body: BulkAlertRequest) => alertsApi.bulk(body),
    onSuccess: (_, body) => {
      const n = body.ids.length;
      notifySuccess(
        body.action === 'resolve'
          ? `${n} ${n === 1 ? 'alerta resolvido' : 'alertas resolvidos'}.`
          : `${n} ${n === 1 ? 'alerta silenciado' : 'alertas silenciados'}.`,
      );
      setSelected(new Set());
      setSnoozeOpened(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.alerts });
      void queryClient.invalidateQueries({ queryKey: queryKeys.activeAlertCount });
    },
  });

  const ids = [...selected];

  return (
    <>
      <PageHeader
        title="Alertas"
        description="Alertas gerados por checks, tarefas e disponibilidade dos agentes."
        actions={
          canManage && (
            <Button component={Link} to={PATHS.alertTemplates} variant="light" leftSection={<IconTemplate size={16} />}>
              Templates de alerta
            </Button>
          )
        }
      />
      <Group mb="md" gap="sm" align="flex-end">
        <SegmentedControl
          aria-label="Situação"
          data={STATUS_FILTER_OPTIONS}
          value={params.status}
          onChange={(v) => updateParams({ status: v === 'active' ? undefined : v })}
        />
        <Select
          aria-label="Severidade"
          placeholder="Todas as severidades"
          clearable
          data={SEVERITY_OPTIONS}
          value={params.severity ?? null}
          onChange={(v) => updateParams({ severidade: v ?? undefined })}
          w={200}
        />
        {clients.data && (
          <Select
            aria-label="Cliente"
            placeholder="Todos os clientes"
            clearable
            searchable
            data={clients.data.map((c) => ({ value: String(c.id), label: c.name }))}
            value={params.clientId ? String(params.clientId) : null}
            onChange={(v) => updateParams({ cliente: v ?? undefined })}
            w={240}
          />
        )}
      </Group>

      {canManage && selected.size > 0 && (
        <Paper withBorder p="sm" mb="md" role="region" aria-label="Ações em lote">
          <Group justify="space-between">
            <Text size="sm" fw={500}>
              {selected.size} {selected.size === 1 ? 'alerta selecionado' : 'alertas selecionados'}
            </Text>
            <Group gap="sm">
              <Button variant="default" size="xs" onClick={() => setSelected(new Set())}>
                Limpar seleção
              </Button>
              <Button size="xs" variant="light" leftSection={<IconBellOff size={14} />} onClick={() => setSnoozeOpened(true)}>
                Silenciar
              </Button>
              <Button
                size="xs"
                color="teal"
                leftSection={<IconCheck size={14} />}
                loading={bulk.isPending && bulk.variables.action === 'resolve'}
                onClick={() => bulk.mutate({ ids, action: 'resolve' })}
              >
                Resolver
              </Button>
            </Group>
          </Group>
        </Paper>
      )}

      {alerts.isError && <LoadError error={alerts.error} onRetry={() => void alerts.refetch()} />}
      <Paper withBorder style={{ opacity: alerts.isPlaceholderData ? 0.6 : 1 }}>
        <AlertsTable
          alerts={alerts.data?.items ?? []}
          loading={alerts.isPending}
          showAgent
          emptyMessage={params.status === 'active' ? 'Nenhum alerta ativo.' : 'Nenhum alerta encontrado.'}
          selection={canManage ? { selected, onChange: setSelected } : undefined}
        />
      </Paper>
      {alerts.data && (
        <Group justify="space-between" mt="md">
          <Text size="sm" c="dimmed">
            {alerts.data.total} {alerts.data.total === 1 ? 'alerta' : 'alertas'}
          </Text>
          <Pagination
            total={totalPages(alerts.data.total, PAGE_SIZE)}
            value={params.page}
            onChange={(p) => updateParams({ pagina: p > 1 ? String(p) : undefined })}
            size="sm"
          />
        </Group>
      )}

      <Modal opened={snoozeOpened} onClose={() => setSnoozeOpened(false)} title="Silenciar alertas" centered>
        {snoozeOpened && (
          <SnoozeForm
            count={selected.size}
            loading={bulk.isPending}
            onCancel={() => setSnoozeOpened(false)}
            onConfirm={(until) => bulk.mutate({ ids, action: 'snooze', until })}
          />
        )}
      </Modal>
    </>
  );
}

function SnoozeForm({ count, loading, onCancel, onConfirm }: { count: number; loading: boolean; onCancel: () => void; onConfirm: (until: string) => void }) {
  const [until, setUntil] = useState<string | null>(dayjs().add(1, 'day').format('YYYY-MM-DD HH:mm:ss'));
  const valid = until !== null && dayjs(until).isAfter(dayjs());
  return (
    <Stack>
      <Text size="sm">
        {count === 1 ? 'O alerta selecionado' : `Os ${count} alertas selecionados`} não vão gerar notificações até a data escolhida.
      </Text>
      <DateTimePicker
        label="Silenciar até"
        required
        valueFormat="DD/MM/YYYY HH:mm"
        minDate={dayjs().format('YYYY-MM-DD HH:mm:ss')}
        value={until}
        onChange={setUntil}
        error={valid ? undefined : 'Escolha uma data futura'}
      />
      <Group justify="flex-end">
        <Button variant="default" onClick={onCancel}>
          Cancelar
        </Button>
        <Button loading={loading} disabled={!valid} onClick={() => until && onConfirm(dayjs(until).toISOString())}>
          Silenciar
        </Button>
      </Group>
    </Stack>
  );
}
