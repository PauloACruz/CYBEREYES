import { Fragment, useMemo, useState } from 'react';
import { ActionIcon, Badge, Button, Group, Paper, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconChevronDown, IconChevronRight, IconCircleCheck, IconCircleX, IconClockHour4, IconPackage, IconRefresh, IconSearch } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { softwareApi } from '../../../api/monitoring';
import { queryKeys } from '../../../api/queryKeys';
import { PERMISSIONS, type AgentDetail, type PendingActionDto } from '../../../api/types';
import { hasPermission } from '../../../auth/permissions';
import { useMe } from '../../../auth/useMe';
import { ApiErrorAlert } from '../../../components/ApiErrorAlert';
import { OutputBlock } from '../../../components/OutputBlock';
import { EmptyRow, LoadError, LoadingRows } from '../../../components/TableStates';
import { confirmAction, notifySuccess } from '../../../lib/feedback';
import { formatDateTime } from '../../../lib/format';
import { isWindows } from '../actions/shells';

const COLUMNS = 4;
const PACKAGE_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/;

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function SoftwareTab({ agent }: { agent: AgentDetail }) {
  const { data: me } = useMe();
  const canInstall = hasPermission(me, PERMISSIONS.softwareManage) && isWindows(agent.plat);
  const queryClient = useQueryClient();
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
      {canInstall && <ChocolateyInstall agent={agent} />}
      {isWindows(agent.plat) && <PendingActions agentId={agent.id} />}
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
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {software.isPending && <LoadingRows columns={COLUMNS} />}
              {software.isSuccess && rows.length === 0 && (
                <EmptyRow columns={COLUMNS} message={(items ?? []).length === 0 ? 'Nenhum software no inventário. Use "Atualizar".' : 'Nenhum software encontrado.'} />
              )}
              {rows.map((item, index) => (
                <Table.Tr key={`${item.name}-${item.version}-${index}`}>
                  <Table.Td fw={500}>{item.name}</Table.Td>
                  <Table.Td>{item.version || 'Não informada'}</Table.Td>
                  <Table.Td>{item.publisher || 'Não informado'}</Table.Td>
                  <Table.Td>{item.installDate || 'Não informada'}</Table.Td>
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
    </Stack>
  );
}

function ChocolateyInstall({ agent }: { agent: AgentDetail }) {
  const queryClient = useQueryClient();
  const [pkg, setPkg] = useState('');
  const valid = PACKAGE_PATTERN.test(pkg.trim());
  const install = useMutation({
    mutationFn: (name: string) => softwareApi.install(agent.id, name),
    onSuccess: (_, name) => {
      notifySuccess(`A instalação de ${name} foi enviada ao agente.`, 'Instalação solicitada');
      setPkg('');
      void queryClient.invalidateQueries({ queryKey: queryKeys.agentPendingActions(agent.id) });
    },
  });
  const submit = () => {
    const name = pkg.trim();
    if (!PACKAGE_PATTERN.test(name)) return;
    confirmAction({
      title: 'Instalar software',
      message: `Instalar o pacote ${name} pelo Chocolatey em ${agent.hostname}?`,
      confirmLabel: 'Instalar',
      onConfirm: () => install.mutate(name),
    });
  };
  return (
    <Paper withBorder p="md">
      <Group gap="xs" mb="xs">
        <IconPackage size={18} aria-hidden />
        <Title order={4}>Instalar pelo Chocolatey</Title>
      </Group>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Group align="flex-end">
          <TextInput
            label="Pacote"
            placeholder="googlechrome, 7zip, vlc..."
            value={pkg}
            onChange={(e) => setPkg(e.currentTarget.value)}
            error={pkg && !valid ? 'Use letras, números, ponto, hífen ou sublinhado' : undefined}
            w={320}
            maw="100%"
          />
          <Button type="submit" loading={install.isPending} disabled={!valid}>
            Instalar
          </Button>
        </Group>
      </form>
    </Paper>
  );
}

function packageName(action: PendingActionDto): string {
  try {
    const parsed: unknown = JSON.parse(action.details);
    if (parsed && typeof parsed === 'object' && 'name' in parsed && typeof parsed.name === 'string') return parsed.name;
  } catch {
    // detalhes invalidos: mostra o texto bruto
  }
  return action.details;
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

function PendingActions({ agentId }: { agentId: number }) {
  const actions = useQuery({
    queryKey: queryKeys.agentPendingActions(agentId),
    queryFn: () => softwareApi.pendingActions(agentId),
    refetchInterval: (query) => (query.state.data?.some((a) => a.status === 'pending') ? 10_000 : false),
  });
  const [expanded, setExpanded] = useState<number | null>(null);
  const rows = actions.data ?? [];
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
            <Table.Th>Pacote</Table.Th>
            <Table.Th w={150}>Situação</Table.Th>
            <Table.Th w={150}>Criada em</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {actions.isPending && <LoadingRows columns={4} rows={2} />}
          {rows.map((action) => {
            const open = expanded === action.id;
            const name = packageName(action);
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
                  <Table.Td>{name}</Table.Td>
                  <Table.Td>
                    <PendingStatus status={action.status} />
                  </Table.Td>
                  <Table.Td>{formatDateTime(action.createdAt)}</Table.Td>
                </Table.Tr>
                {open && (
                  <Table.Tr>
                    <Table.Td colSpan={4}>
                      <OutputBlock label="Saída" value={action.output ?? ''} emptyText="Ainda sem saída." maxHeight={280} />
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
