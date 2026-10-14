import { useMemo, useState } from 'react';
import { Alert, Badge, Button, Group, Paper, SegmentedControl, Stack, Switch, Table, Text, TextInput, Tooltip } from '@mantine/core';
import { IconInfoCircle, IconRefresh, IconSearch } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { agentActionsApi } from '../../../api/agentActions';
import { queryKeys } from '../../../api/queryKeys';
import type { AgentDetail, StartupItemDto, StartupLocation } from '../../../api/types';
import { EmptyRow, LoadError, LoadingRows } from '../../../components/TableStates';
import { confirmAction, notifySuccess } from '../../../lib/feedback';
import { formatDateTime } from '../../../lib/format';

const LOCATION_LABEL: Record<StartupLocation, string> = {
  Run: 'Registro (Run)',
  Run32: 'Registro 32 bits (Run)',
  StartupFolder: 'Pasta Inicializar',
};

type StateFilter = 'all' | 'enabled' | 'disabled';

const keyOf = (item: StartupItemDto) => `${item.scope}|${item.location}|${item.name}`;

/** Nome mostrado: a descricao do executavel quando existe (como o Gerenciador de Tarefas), senao o nome da entrada. */
function title(item: StartupItemDto): string {
  return item.description || item.name;
}

/**
 * Programas da inicializacao do Windows: os mesmos do Gerenciador de Tarefas, da maquina e dos usuarios com sessao aberta.
 * Desabilitar so impede o programa de abrir no logon; a entrada continua e pode ser habilitada de novo.
 */
export function StartupTab({ agent, canControl }: { agent: AgentDetail; canControl: boolean }) {
  const queryClient = useQueryClient();
  const key = queryKeys.agentStartup(agent.id);
  const startup = useQuery({ queryKey: key, queryFn: () => agentActionsApi.startup(agent.id), retry: false });
  const [search, setSearch] = useState('');
  const [state, setState] = useState<StateFilter>('all');

  const change = useMutation({
    mutationFn: (item: StartupItemDto) =>
      agentActionsApi.changeStartup(agent.id, { scope: item.scope, location: item.location, name: item.name, enabled: !item.enabled }),
    onSuccess: (list, item) => {
      queryClient.setQueryData(key, list);
      notifySuccess(`${title(item)} ${item.enabled ? 'não vai mais abrir' : 'volta a abrir'} na inicialização do Windows.`);
    },
  });

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (startup.data?.items ?? [])
      .filter((i) => state === 'all' || (state === 'enabled') === i.enabled)
      .filter(
        (i) =>
          !term ||
          [i.name, i.description, i.publisher, i.command, i.user].some((value) => value?.toLowerCase().includes(term)),
      );
  }, [startup.data, search, state]);

  const toggle = (item: StartupItemDto) => {
    if (!item.enabled) {
      change.mutate(item);
      return;
    }
    confirmAction({
      title: 'Desabilitar na inicialização',
      message: `${title(item)} deixa de abrir quando ${item.user ? item.user : 'qualquer usuário'} entrar no Windows. A entrada continua e pode ser habilitada de novo.`,
      confirmLabel: 'Desabilitar',
      onConfirm: () => change.mutate(item),
    });
  };

  const busyKey = change.isPending ? keyOf(change.variables) : null;
  const disabledCount = startup.data?.items.filter((i) => !i.enabled).length ?? 0;
  const columns = 5;

  return (
    <Stack gap="md">
      <Group justify="space-between" wrap="wrap">
        <Group gap="sm" wrap="wrap">
          <TextInput
            placeholder="Buscar programa"
            aria-label="Buscar programas da inicialização"
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
              { value: 'enabled', label: 'Habilitados' },
              { value: 'disabled', label: `Desabilitados${disabledCount ? ` (${disabledCount})` : ''}` },
            ]}
          />
        </Group>
        <Button variant="light" leftSection={<IconRefresh size={16} />} loading={startup.isFetching} onClick={() => void startup.refetch()}>
          Atualizar
        </Button>
      </Group>
      {startup.data && (
        <Alert variant="light" color="gray" icon={<IconInfoCircle size={18} />} p="sm">
          <Text size="sm">
            Mostra a máquina e{' '}
            {startup.data.users.length === 0
              ? 'nenhum usuário (ninguém está com sessão aberta agora)'
              : `os usuários com sessão aberta: ${startup.data.users.join(', ')}`}
            . Usuários sem sessão não aparecem. Desabilitar funciona como no Gerenciador de Tarefas: o programa não abre no próximo logon, e a
            entrada fica para ser habilitada de novo.
          </Text>
        </Alert>
      )}
      {startup.isError && <LoadError error={startup.error} onRetry={() => void startup.refetch()} />}
      <Paper withBorder>
        <Table.ScrollContainer minWidth={820}>
          <Table striped highlightOnHover verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Programa</Table.Th>
                <Table.Th>Publicador</Table.Th>
                <Table.Th>Para quem</Table.Th>
                <Table.Th>Origem</Table.Th>
                <Table.Th w={150}>Inicialização</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {startup.isPending && <LoadingRows columns={columns} />}
              {startup.isSuccess && rows.length === 0 && <EmptyRow columns={columns} message="Nenhum programa na inicialização." />}
              {rows.map((item) => (
                <Table.Tr key={keyOf(item)}>
                  <Table.Td>
                    <Tooltip label={item.command} disabled={!item.command} multiline maw={520} openDelay={400}>
                      <div>
                        <Text size="sm" fw={500}>
                          {title(item)}
                        </Text>
                        {item.description && item.description !== item.name && (
                          <Text size="xs" c="dimmed">
                            {item.name}
                          </Text>
                        )}
                      </div>
                    </Tooltip>
                  </Table.Td>
                  <Table.Td>{item.publisher ?? <Text span size="sm" c="dimmed">Desconhecido</Text>}</Table.Td>
                  <Table.Td>{item.user ?? 'Todos os usuários'}</Table.Td>
                  <Table.Td>{LOCATION_LABEL[item.location]}</Table.Td>
                  <Table.Td>
                    {canControl ? (
                      <Switch
                        checked={item.enabled}
                        disabled={busyKey !== null}
                        label={busyKey === keyOf(item) ? 'Aplicando…' : item.enabled ? 'Habilitado' : 'Desabilitado'}
                        aria-label={`${title(item)}: ${item.enabled ? 'habilitado' : 'desabilitado'} na inicialização`}
                        onChange={() => toggle(item)}
                      />
                    ) : (
                      <Badge variant="light" color={item.enabled ? 'teal' : 'gray'}>
                        {item.enabled ? 'Habilitado' : 'Desabilitado'}
                      </Badge>
                    )}
                    {!item.enabled && item.disabledAt && (
                      <Text size="xs" c="dimmed" mt={2}>
                        desde {formatDateTime(item.disabledAt)}
                      </Text>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
    </Stack>
  );
}
