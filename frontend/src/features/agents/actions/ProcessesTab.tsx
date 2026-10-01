import { useMemo, useState } from 'react';
import { ActionIcon, Button, Group, Paper, Table, Text, TextInput, Tooltip } from '@mantine/core';
import { IconRefresh, IconSearch, IconX } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { agentActionsApi } from '../../../api/agentActions';
import { queryKeys } from '../../../api/queryKeys';
import type { AgentDetail, ProcessDto } from '../../../api/types';
import { SortableTh, type SortState } from '../../../components/SortableTh';
import { compareValues } from '../../../lib/sort';
import { EmptyRow, LoadError, LoadingRows } from '../../../components/TableStates';
import { confirmAction, notifySuccess } from '../../../lib/feedback';
import { formatBytes } from '../../../lib/format';

type SortKey = 'name' | 'pid' | 'username' | 'memBytes' | 'cpuPercent';

const percentFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

export function ProcessesTab({ agent, canControl }: { agent: AgentDetail; canControl: boolean }) {
  const queryClient = useQueryClient();
  const key = queryKeys.agentProcesses(agent.id);
  const processes = useQuery({ queryKey: key, queryFn: () => agentActionsApi.processes(agent.id), retry: false });
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortState<SortKey>>({ key: 'memBytes', direction: 'desc' });

  const kill = useMutation({
    mutationFn: (proc: ProcessDto) => agentActionsApi.killProcess(agent.id, proc.pid),
    onSuccess: (_, proc) => {
      notifySuccess(`O processo ${proc.name} (PID ${proc.pid}) foi encerrado.`);
      queryClient.setQueryData<ProcessDto[]>(key, (old) => old?.filter((p) => p.pid !== proc.pid));
    },
  });

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = (processes.data ?? []).filter(
      (p) => !term || p.name.toLowerCase().includes(term) || String(p.pid).includes(term) || p.username.toLowerCase().includes(term),
    );
    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => factor * compareValues(a[sort.key], b[sort.key]));
  }, [processes.data, search, sort]);

  const columns = canControl ? 6 : 5;

  const confirmKill = (proc: ProcessDto) =>
    confirmAction({
      title: 'Encerrar processo',
      message: `Encerrar ${proc.name} (PID ${proc.pid}) em ${agent.hostname}? Dados não salvos nesse programa serão perdidos.`,
      confirmLabel: 'Encerrar processo',
      danger: true,
      onConfirm: () => kill.mutate(proc),
    });

  return (
    <>
      <Group justify="space-between" mb="md" wrap="wrap">
        <TextInput
          placeholder="Buscar por nome, PID ou usuário"
          aria-label="Buscar processos"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          w={340}
        />
        <Group gap="sm">
          {processes.data && (
            <Text size="sm" c="dimmed">
              {rows.length} de {processes.data.length} processos
            </Text>
          )}
          <Button variant="light" leftSection={<IconRefresh size={16} />} loading={processes.isFetching} onClick={() => void processes.refetch()}>
            Atualizar
          </Button>
        </Group>
      </Group>
      {processes.isError && <LoadError error={processes.error} onRetry={() => void processes.refetch()} />}
      <Paper withBorder>
        <Table.ScrollContainer minWidth={720}>
          <Table striped highlightOnHover verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <SortableTh label="Nome" column="name" sort={sort} onSort={setSort} />
                <SortableTh label="PID" column="pid" sort={sort} onSort={setSort} w={100} />
                <SortableTh label="Usuário" column="username" sort={sort} onSort={setSort} />
                <SortableTh label="Memória" column="memBytes" sort={sort} onSort={setSort} w={130} />
                <SortableTh label="CPU" column="cpuPercent" sort={sort} onSort={setSort} w={100} />
                {canControl && <Table.Th w={60} aria-label="Ações" />}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {processes.isPending && <LoadingRows columns={columns} />}
              {processes.isSuccess && rows.length === 0 && (
                <EmptyRow columns={columns} message={search ? 'Nenhum processo encontrado para a busca.' : 'Nenhum processo informado.'} />
              )}
              {rows.map((proc) => (
                <Table.Tr key={proc.pid}>
                  <Table.Td fw={500}>{proc.name}</Table.Td>
                  <Table.Td ff="monospace">{proc.pid}</Table.Td>
                  <Table.Td>{proc.username}</Table.Td>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>{formatBytes(proc.memBytes)}</Table.Td>
                  <Table.Td>{percentFormat.format(proc.cpuPercent)}%</Table.Td>
                  {canControl && (
                    <Table.Td>
                      <Tooltip label="Encerrar processo">
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          aria-label={`Encerrar ${proc.name} (PID ${proc.pid})`}
                          loading={kill.isPending && kill.variables.pid === proc.pid}
                          onClick={() => confirmKill(proc)}
                        >
                          <IconX size={16} />
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
    </>
  );
}
