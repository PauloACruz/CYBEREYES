import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ActionIcon, Badge, Button, Group, Paper, Stack, Table, Text, TextInput, Title, Tooltip } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconChevronDown, IconChevronRight, IconCircleCheck, IconCircleX, IconClockHour4, IconRefresh, IconSearch, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { softwareApi } from '../../../api/monitoring';
import { queryKeys } from '../../../api/queryKeys';
import { PERMISSIONS, type AgentDetail, type SoftwareItem } from '../../../api/types';
import { hasPermission } from '../../../auth/permissions';
import { useMe } from '../../../auth/useMe';
import { ApiErrorAlert } from '../../../components/ApiErrorAlert';
import { OutputBlock } from '../../../components/OutputBlock';
import { EmptyRow, LoadError, LoadingRows } from '../../../components/TableStates';
import { notifySuccess } from '../../../lib/feedback';
import { formatDateTime } from '../../../lib/format';
import { isWindows } from '../actions/shells';
import { LeftoversModal, type LeftoversTarget } from './LeftoversModal';
import { PackageInstall } from './PackageInstall';
import { MANAGER_LABEL } from './packageManagers';
import { actionName, actionOutput, actionResult, describeAction, installManager, UNINSTALL_TYPE } from './softwareActions';
import { UninstallModal } from './UninstallModal';

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function SoftwareTab({ agent }: { agent: AgentDetail }) {
  const { data: me } = useMe();
  const canManage = hasPermission(me, PERMISSIONS.softwareManage) && isWindows(agent.plat);
  const columns = canManage ? 5 : 4;
  const queryClient = useQueryClient();
  const [uninstalling, setUninstalling] = useState<SoftwareItem | null>(null);
  const [review, setReview] = useState<LeftoversTarget | null>(null);
  const software = useQuery({ queryKey: queryKeys.agentSoftware(agent.id), queryFn: () => softwareApi.list(agent.id) });
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search, 200);

  const refresh = useMutation({
    mutationFn: () => softwareApi.refresh(agent.id, { silent: true }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.agentSoftware(agent.id), data);
      notifySuccess('Inventário de software atualizado.');
    },
  });

  const items = software.data?.items;
  const rows = useMemo(() => {
    const term = normalize(debounced.trim());
    const list = items ?? [];
    const filtered = term ? list.filter((i) => normalize(`${i.name} ${i.publisher} ${i.version}`).includes(term)) : list;
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
  }, [items, debounced]);

  return (
    <Stack>
      {canManage && <PackageInstall agent={agent} />}
      {isWindows(agent.plat) && (
        <PendingActions agentId={agent.id} canManage={canManage} onReview={setReview} onUninstallFinished={refresh.mutate} />
      )}
      <Group justify="space-between">
        <TextInput
          placeholder="Pesquisar por nome, fabricante ou versão"
          aria-label="Pesquisar software"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          w={360}
          maw="100%"
        />
        <Group gap="sm">
          <Text size="sm" c="dimmed">
            {software.data?.updatedAt ? `Atualizado em ${formatDateTime(software.data.updatedAt)}` : 'Inventário ainda não coletado'}
          </Text>
          <Button variant="light" leftSection={<IconRefresh size={16} />} loading={refresh.isPending} onClick={() => refresh.mutate()}>
            Atualizar
          </Button>
        </Group>
      </Group>
      {refresh.isError && <ApiErrorAlert error={refresh.error} />}
      {software.isError && <LoadError error={software.error} onRetry={() => void software.refetch()} />}
      <Paper withBorder>
        <Table.ScrollContainer minWidth={700}>
          <Table verticalSpacing="xs" striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Nome</Table.Th>
                <Table.Th w={160}>Versão</Table.Th>
                <Table.Th>Fabricante</Table.Th>
                <Table.Th w={130}>Instalado em</Table.Th>
                {canManage && <Table.Th w={70} aria-label="Ações" />}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {software.isPending && <LoadingRows columns={columns} />}
              {software.isSuccess && rows.length === 0 && (
                <EmptyRow columns={columns} message={(items ?? []).length === 0 ? 'Nenhum software no inventário. Use "Atualizar".' : 'Nenhum software encontrado.'} />
              )}
              {rows.map((item, index) => (
                <Table.Tr key={`${item.name}-${item.version}-${index}`}>
                  <Table.Td fw={500}>{item.name}</Table.Td>
                  <Table.Td>{item.version || 'Não informada'}</Table.Td>
                  <Table.Td>{item.publisher || 'Não informado'}</Table.Td>
                  <Table.Td>{item.installDate || 'Não informada'}</Table.Td>
                  {canManage && (
                    <Table.Td>
                      <Tooltip label="Desinstalação avançada">
                        <ActionIcon variant="subtle" color="red" aria-label={`Desinstalar ${item.name}`} onClick={() => setUninstalling(item)}>
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Tooltip>
                    </Table.Td>
                  )}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
      {software.isSuccess && (
        <Text size="sm" c="dimmed">
          {rows.length} de {(items ?? []).length} programas
        </Text>
      )}
      {canManage && (
        <>
          <UninstallModal agent={agent} item={uninstalling} onClose={() => setUninstalling(null)} />
          <LeftoversModal agent={agent} target={review} onClose={() => setReview(null)} />
        </>
      )}
    </Stack>
  );
}

function PendingStatus({ status }: { status: string }) {
  if (status === 'completed') {
    return (
      <Badge color="teal" variant="light" leftSection={<IconCircleCheck size={12} aria-hidden />}>
        Concluída
      </Badge>
    );
  }
  if (status === 'failed' || status === 'error') {
    return (
      <Badge color="red" variant="light" leftSection={<IconCircleX size={12} aria-hidden />}>
        Falhou
      </Badge>
    );
  }
  return (
    <Badge color="gray" variant="light" leftSection={<IconClockHour4 size={12} aria-hidden />}>
      {status === 'pending' ? 'Pendente' : status}
    </Badge>
  );
}

interface PendingActionsProps {
  agentId: number;
  canManage: boolean;
  onReview: (target: LeftoversTarget) => void;
  /** Chamado quando uma desinstalacao acompanhada nesta tela termina (para atualizar o inventario). */
  onUninstallFinished: () => void;
}

function PendingActions({ agentId, canManage, onReview, onUninstallFinished }: PendingActionsProps) {
  const actions = useQuery({
    queryKey: queryKeys.agentPendingActions(agentId),
    queryFn: () => softwareApi.pendingActions(agentId),
    refetchInterval: (query) => (query.state.data?.some((a) => a.status === 'pending') ? 10_000 : false),
  });
  const [expanded, setExpanded] = useState<number | null>(null);
  const rows = actions.data ?? [];
  const waiting = useRef(new Set<number>());
  useEffect(() => {
    let finished = false;
    for (const action of actions.data ?? []) {
      if (action.type !== UNINSTALL_TYPE) continue;
      if (action.status === 'pending') waiting.current.add(action.id);
      else if (waiting.current.delete(action.id)) finished = true;
    }
    if (finished) onUninstallFinished();
  }, [actions.data, onUninstallFinished]);
  if (actions.isSuccess && rows.length === 0) return null;
  return (
    <Paper withBorder>
      <Group p="sm" pb={0}>
        <Title order={5}>Ações pendentes e recentes</Title>
      </Group>
      {actions.isError && <LoadError error={actions.error} onRetry={() => void actions.refetch()} />}
      <Table verticalSpacing="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={40} aria-label="Expandir" />
            <Table.Th>Ação</Table.Th>
            <Table.Th w={150}>Situação</Table.Th>
            <Table.Th w={150}>Criada em</Table.Th>
            <Table.Th w={170} aria-label="Sobras" />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {actions.isPending && <LoadingRows columns={5} rows={2} />}
          {rows.map((action) => {
            const open = expanded === action.id;
            const name = describeAction(action);
            const manager = installManager(action);
            const result = actionResult(action);
            const leftovers = action.type === UNINSTALL_TYPE ? (result?.leftovers.length ?? 0) : 0;
            return (
              <Fragment key={action.id}>
                <Table.Tr>
                  <Table.Td>
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      size="sm"
                      aria-label={open ? `Recolher saída de ${name}` : `Ver saída de ${name}`}
                      aria-expanded={open}
                      onClick={() => setExpanded(open ? null : action.id)}
                    >
                      {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                    </ActionIcon>
                  </Table.Td>
                  <Table.Td>
                    {name}
                    {manager && (
                      <>
                        {' '}
                        <Text span size="xs" c="dimmed">
                          ({MANAGER_LABEL[manager]})
                        </Text>
                      </>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4}>
                      <PendingStatus status={action.status} />
                      {result?.reboot && (
                        <Badge color="orange" variant="light">
                          Reiniciar
                        </Badge>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>{formatDateTime(action.createdAt)}</Table.Td>
                  <Table.Td>
                    {canManage && result && leftovers > 0 && (
                      <Button
                        size="xs"
                        variant="light"
                        onClick={() => onReview({ actionId: action.id, name: actionName(action), result })}
                      >
                        Revisar {leftovers} sobra(s)
                      </Button>
                    )}
                  </Table.Td>
                </Table.Tr>
                {open && (
                  <Table.Tr>
                    <Table.Td colSpan={5}>
                      <OutputBlock label="Saída" value={actionOutput(action)} emptyText="Ainda sem saída." maxHeight={280} />
                    </Table.Td>
                  </Table.Tr>
                )}
              </Fragment>
            );
          })}
        </Table.Tbody>
      </Table>
    </Paper>
  );
}
