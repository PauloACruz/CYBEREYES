import { useMemo, useState } from 'react';
import { ActionIcon, Badge, Button, Group, Menu, Paper, SegmentedControl, Table, Text, TextInput, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconDotsVertical,
  IconPlayerPlay,
  IconPlayerStop,
  IconRefresh,
  IconRotateClockwise,
  IconSearch,
  IconSettings,
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { agentActionsApi } from '../../../api/agentActions';
import { queryKeys } from '../../../api/queryKeys';
import type { AgentDetail, ServiceAction, ServiceStartType, SuccessMessage, WindowsServiceDto } from '../../../api/types';
import { EmptyRow, LoadError, LoadingRows } from '../../../components/TableStates';
import { confirmAction, notifySuccess } from '../../../lib/feedback';

const STATUS: Record<string, { label: string; color: string }> = {
  running: { label: 'Em execução', color: 'teal' },
  stopped: { label: 'Parado', color: 'gray' },
  start_pending: { label: 'Iniciando', color: 'blue' },
  stop_pending: { label: 'Parando', color: 'orange' },
  paused: { label: 'Pausado', color: 'yellow' },
};

const START_TYPES: readonly { value: ServiceStartType; label: string }[] = [
  { value: 'auto', label: 'Automático' },
  { value: 'autodelay', label: 'Automático (atraso)' },
  { value: 'manual', label: 'Manual' },
  { value: 'disabled', label: 'Desativado' },
];

const ACTION_LABEL: Record<ServiceAction, { verb: string; done: string }> = {
  start: { verb: 'Iniciar', done: 'iniciado' },
  stop: { verb: 'Parar', done: 'parado' },
  restart: { verb: 'Reiniciar', done: 'reiniciado' },
};

type StateFilter = 'all' | 'running' | 'stopped';

function startTypeOf(svc: WindowsServiceDto): string {
  const type = svc.startType.toLowerCase();
  if ((type === 'auto' || type === 'automatic') && svc.autodelay) return 'autodelay';
  if (type === 'automatic') return 'auto';
  return type;
}

function startTypeLabel(svc: WindowsServiceDto): string {
  const type = startTypeOf(svc);
  return START_TYPES.find((t) => t.value === type)?.label ?? svc.startType;
}

function reportResult(result: SuccessMessage, successText: string): void {
  if (result.success) notifySuccess(successText);
  else notifications.show({ color: 'red', title: 'O agente recusou a ação', message: result.message || 'Sem detalhes.' });
}

export function LiveServicesTab({ agent, canControl }: { agent: AgentDetail; canControl: boolean }) {
  const queryClient = useQueryClient();
  const key = queryKeys.agentServices(agent.id);
  const services = useQuery({ queryKey: key, queryFn: () => agentActionsApi.services(agent.id), retry: false });
  const [search, setSearch] = useState('');
  const [state, setState] = useState<StateFilter>('all');

  const refresh = () => void queryClient.invalidateQueries({ queryKey: key });

  const action = useMutation({
    mutationFn: ({ svc, act }: { svc: WindowsServiceDto; act: ServiceAction }) => agentActionsApi.serviceAction(agent.id, svc.name, act),
    onSuccess: (result, { svc, act }) => {
      reportResult(result, `Serviço ${svc.displayName || svc.name} ${ACTION_LABEL[act].done}.`);
      refresh();
    },
  });
  const startType = useMutation({
    mutationFn: ({ svc, type }: { svc: WindowsServiceDto; type: ServiceStartType }) => agentActionsApi.serviceStartType(agent.id, svc.name, type),
    onSuccess: (result, { svc }) => {
      reportResult(result, `Tipo de inicialização de ${svc.displayName || svc.name} alterado.`);
      refresh();
    },
  });

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (services.data ?? [])
      .filter((s) => state === 'all' || s.status.toLowerCase() === state)
      .filter((s) => !term || s.name.toLowerCase().includes(term) || s.displayName.toLowerCase().includes(term) || s.description.toLowerCase().includes(term))
      .sort((a, b) => (a.displayName || a.name).localeCompare(b.displayName || b.name, 'pt-BR'));
  }, [services.data, search, state]);

  const busyName = action.isPending ? action.variables.svc.name : startType.isPending ? startType.variables.svc.name : null;

  const confirmServiceAction = (svc: WindowsServiceDto, act: ServiceAction) =>
    confirmAction({
      title: `${ACTION_LABEL[act].verb} serviço`,
      message: `${ACTION_LABEL[act].verb} o serviço ${svc.displayName || svc.name} em ${agent.hostname}?`,
      confirmLabel: ACTION_LABEL[act].verb,
      danger: act !== 'start',
      onConfirm: () => action.mutate({ svc, act }),
    });

  const confirmStartType = (svc: WindowsServiceDto, type: ServiceStartType) =>
    confirmAction({
      title: 'Alterar tipo de inicialização',
      message: `Alterar ${svc.displayName || svc.name} para "${START_TYPES.find((t) => t.value === type)?.label ?? type}"?`,
      confirmLabel: 'Alterar',
      danger: type === 'disabled',
      onConfirm: () => startType.mutate({ svc, type }),
    });

  const columns = canControl ? 5 : 4;

  return (
    <>
      <Group justify="space-between" mb="md" wrap="wrap">
        <Group gap="sm" wrap="wrap">
          <TextInput
            placeholder="Buscar serviço"
            aria-label="Buscar serviços"
            leftSection={<IconSearch size={16} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            w={300}
          />
          <SegmentedControl
            aria-label="Filtrar por estado"
            value={state}
            onChange={setState}
            data={[
              { value: 'all', label: 'Todos' },
              { value: 'running', label: 'Em execução' },
              { value: 'stopped', label: 'Parados' },
            ]}
          />
        </Group>
        <Button variant="light" leftSection={<IconRefresh size={16} />} loading={services.isFetching} onClick={() => void services.refetch()}>
          Atualizar
        </Button>
      </Group>
      {services.isError && <LoadError error={services.error} onRetry={() => void services.refetch()} />}
      <Paper withBorder>
        <Table.ScrollContainer minWidth={760}>
          <Table striped highlightOnHover verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Nome</Table.Th>
                <Table.Th>Estado</Table.Th>
                <Table.Th>Inicialização</Table.Th>
                <Table.Th>Conta</Table.Th>
                {canControl && <Table.Th w={60} aria-label="Ações" />}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {services.isPending && <LoadingRows columns={columns} />}
              {services.isSuccess && rows.length === 0 && <EmptyRow columns={columns} message="Nenhum serviço encontrado." />}
              {rows.map((svc) => {
                const status = STATUS[svc.status.toLowerCase()];
                const running = svc.status.toLowerCase() === 'running';
                const currentType = startTypeOf(svc);
                return (
                  <Table.Tr key={svc.name}>
                    <Table.Td>
                      <Tooltip label={svc.description} disabled={!svc.description} multiline maw={420} openDelay={400}>
                        <div>
                          <Text size="sm" fw={500}>
                            {svc.displayName || svc.name}
                          </Text>
                          {svc.displayName && svc.displayName !== svc.name && (
                            <Text size="xs" c="dimmed">
                              {svc.name}
                            </Text>
                          )}
                        </div>
                      </Tooltip>
                    </Table.Td>
                    <Table.Td>
                      <Badge variant="light" size="sm" color={status?.color ?? 'gray'}>
                        {status?.label ?? (svc.status || 'Desconhecido')}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{startTypeLabel(svc)}</Table.Td>
                    <Table.Td>{svc.username}</Table.Td>
                    {canControl && (
                      <Table.Td>
                        <Menu position="bottom-end" withinPortal shadow="md">
                          <Menu.Target>
                            <ActionIcon variant="subtle" color="gray" aria-label={`Ações de ${svc.displayName || svc.name}`} loading={busyName === svc.name}>
                              <IconDotsVertical size={16} />
                            </ActionIcon>
                          </Menu.Target>
                          <Menu.Dropdown>
                            <Menu.Item leftSection={<IconPlayerPlay size={14} />} disabled={running} onClick={() => confirmServiceAction(svc, 'start')}>
                              Iniciar
                            </Menu.Item>
                            <Menu.Item leftSection={<IconPlayerStop size={14} />} disabled={!running} onClick={() => confirmServiceAction(svc, 'stop')}>
                              Parar
                            </Menu.Item>
                            <Menu.Item leftSection={<IconRotateClockwise size={14} />} disabled={!running} onClick={() => confirmServiceAction(svc, 'restart')}>
                              Reiniciar
                            </Menu.Item>
                            <Menu.Divider />
                            <Menu.Label>Tipo de inicialização</Menu.Label>
                            {START_TYPES.map((t) => (
                              <Menu.Item
                                key={t.value}
                                leftSection={<IconSettings size={14} />}
                                disabled={t.value === currentType}
                                onClick={() => confirmStartType(svc, t.value)}
                              >
                                {t.label}
                              </Menu.Item>
                            ))}
                          </Menu.Dropdown>
                        </Menu>
                      </Table.Td>
                    )}
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
    </>
  );
}
