import { useMemo, useState } from 'react';
import { Anchor, Badge, Button, Group, Paper, SegmentedControl, Select, Stack, Table, Text, Title } from '@mantine/core';
import { IconCircleCheck, IconClockHour4, IconDownload, IconRefresh, IconShieldCheck } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { patchesApi } from '../../../api/monitoring';
import { queryKeys } from '../../../api/queryKeys';
import { PERMISSIONS, type AgentDetail, type PatchPolicy, type UpdateAction, type WinUpdateDto } from '../../../api/types';
import { hasPermission } from '../../../auth/permissions';
import { useMe } from '../../../auth/useMe';
import { EmptyRow, LoadError, LoadingRows } from '../../../components/TableStates';
import { confirmAction, notifySuccess } from '../../../lib/feedback';
import { formatDate } from '../../../lib/format';
import { PatchPolicyForm, PatchPolicySummary } from '../../monitoring/patches/PatchPolicyForm';

const COLUMNS = 5;

const ACTION_OPTIONS: { value: UpdateAction; label: string }[] = [
  { value: 'nothing', label: 'Nada' },
  { value: 'approve', label: 'Aprovar' },
  { value: 'ignore', label: 'Ignorar' },
];

type Filter = 'pending' | 'installed' | 'all';

const MS_SEVERITY: Record<string, string> = {
  Critical: 'Crítica',
  Important: 'Importante',
  Moderate: 'Moderada',
  Low: 'Baixa',
  Unspecified: 'Não especificada',
};

function InstalledBadge({ update }: { update: WinUpdateDto }) {
  if (update.installed) {
    return (
      <Badge color="teal" variant="light" leftSection={<IconCircleCheck size={12} aria-hidden />}>
        Instalada
      </Badge>
    );
  }
  return (
    <Badge color="orange" variant="light" leftSection={<IconClockHour4 size={12} aria-hidden />}>
      {update.downloaded ? 'Pendente (baixada)' : 'Pendente'}
    </Badge>
  );
}

export function UpdatesTab({ agent }: { agent: AgentDetail }) {
  const { data: me } = useMe();
  const canManage = hasPermission(me, PERMISSIONS.patchesManage);
  const queryClient = useQueryClient();
  const updates = useQuery({ queryKey: queryKeys.agentUpdates(agent.id), queryFn: () => patchesApi.list(agent.id) });
  const [filter, setFilter] = useState<Filter>('pending');
  const refresh = () => void queryClient.invalidateQueries({ queryKey: queryKeys.agentUpdates(agent.id) });

  const scan = useMutation({
    mutationFn: () => patchesApi.scan(agent.id),
    onSuccess: () => {
      notifySuccess('O agente vai procurar atualizações. A lista é atualizada quando ele responder.', 'Procura iniciada');
      setTimeout(refresh, 10_000);
    },
  });
  const install = useMutation({
    mutationFn: () => patchesApi.install(agent.id),
    onSuccess: () => notifySuccess('A instalação das atualizações aprovadas foi enviada ao agente.', 'Instalação iniciada'),
  });
  const setAction = useMutation({
    mutationFn: ({ update, action }: { update: WinUpdateDto; action: UpdateAction }) => patchesApi.setAction(agent.id, update.id, action),
    onSuccess: refresh,
  });

  const all = useMemo(() => updates.data ?? [], [updates.data]);
  const rows = useMemo(
    () => all.filter((u) => (filter === 'all' ? true : filter === 'installed' ? u.installed : !u.installed)),
    [all, filter],
  );
  const approvedPending = all.filter((u) => !u.installed && u.action === 'approve').length;

  return (
    <Stack>
      <PatchPolicyCard agentId={agent.id} canManage={canManage} />
      <Group justify="space-between">
        <SegmentedControl
          value={filter}
          onChange={(v) => setFilter(v)}
          data={[
            { value: 'pending', label: 'Pendentes' },
            { value: 'installed', label: 'Instaladas' },
            { value: 'all', label: 'Todas' },
          ]}
          aria-label="Filtrar atualizações"
        />
        <Group gap="sm">
          <Button variant="light" leftSection={<IconRefresh size={16} />} loading={scan.isPending} onClick={() => scan.mutate()}>
            Procurar atualizações
          </Button>
          {canManage && (
            <Button
              leftSection={<IconDownload size={16} />}
              loading={install.isPending}
              disabled={approvedPending === 0}
              onClick={() =>
                confirmAction({
                  title: 'Instalar atualizações',
                  message: `Instalar agora ${approvedPending} ${approvedPending === 1 ? 'atualização aprovada' : 'atualizações aprovadas'} em ${agent.hostname}?`,
                  confirmLabel: 'Instalar',
                  onConfirm: () => install.mutate(),
                })
              }
            >
              Instalar aprovadas agora
            </Button>
          )}
        </Group>
      </Group>
      {updates.isError && <LoadError error={updates.error} onRetry={() => void updates.refetch()} />}
      <Paper withBorder>
        <Table.ScrollContainer minWidth={820}>
          <Table verticalSpacing="xs" striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={110}>KB</Table.Th>
                <Table.Th>Título</Table.Th>
                <Table.Th w={130}>Severidade</Table.Th>
                <Table.Th w={170}>Situação</Table.Th>
                <Table.Th w={150}>Ação</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {updates.isPending && <LoadingRows columns={COLUMNS} />}
              {updates.isSuccess && rows.length === 0 && (
                <EmptyRow columns={COLUMNS} message={all.length === 0 ? 'Nenhuma atualização registrada. Use "Procurar atualizações".' : 'Nenhuma atualização neste filtro.'} />
              )}
              {rows.map((u) => (
                <Table.Tr key={u.id}>
                  <Table.Td ff="monospace">{u.kb || 'Sem KB'}</Table.Td>
                  <Table.Td>
                    {u.moreInfoUrls[0] ? (
                      <Anchor href={u.moreInfoUrls[0]} target="_blank" rel="noopener noreferrer" size="sm">
                        {u.title}
                      </Anchor>
                    ) : (
                      <Text size="sm">{u.title}</Text>
                    )}
                    {u.installed && u.dateInstalled && (
                      <Text size="xs" c="dimmed">
                        Instalada em {formatDate(u.dateInstalled)}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>{u.severity ? (MS_SEVERITY[u.severity] ?? u.severity) : 'Não informada'}</Table.Td>
                  <Table.Td>
                    <InstalledBadge update={u} />
                  </Table.Td>
                  <Table.Td>
                    {canManage && !u.installed ? (
                      <Select
                        size="xs"
                        allowDeselect={false}
                        aria-label={`Ação para ${u.kb || u.title}`}
                        data={ACTION_OPTIONS}
                        value={u.action}
                        disabled={setAction.isPending && setAction.variables.update.id === u.id}
                        onChange={(v) => v && v !== u.action && setAction.mutate({ update: u, action: v })}
                      />
                    ) : (
                      <Text size="sm">{ACTION_OPTIONS.find((o) => o.value === u.action)?.label ?? u.action}</Text>
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

function PatchPolicyCard({ agentId, canManage }: { agentId: number; canManage: boolean }) {
  const queryClient = useQueryClient();
  const policy = useQuery({ queryKey: queryKeys.agentPatchPolicy(agentId), queryFn: () => patchesApi.agentPolicy(agentId) });
  const [editing, setEditing] = useState(false);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: queryKeys.agentPatchPolicy(agentId) });

  const save = useMutation({
    mutationFn: (body: PatchPolicy) => patchesApi.saveAgentPolicy(agentId, body),
    onSuccess: () => {
      notifySuccess('Política de patch do agente salva.');
      setEditing(false);
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: () => patchesApi.removeAgentPolicy(agentId),
    onSuccess: () => {
      notifySuccess('O agente voltou a seguir a política de patch herdada.');
      refresh();
    },
  });

  const own = policy.data?.own ?? null;
  return (
    <Paper withBorder p="md">
      <Group justify="space-between" mb="xs" align="flex-start">
        <Group gap="xs">
          <IconShieldCheck size={18} aria-hidden />
          <Title order={4}>Política de patch efetiva</Title>
          {policy.data && (
            <Badge variant="light" color={own ? 'blue' : 'gray'}>
              {own ? 'Própria do agente' : 'Herdada'}
            </Badge>
          )}
        </Group>
        {canManage && policy.data && !editing && (
          <Group gap="xs">
            <Button size="xs" variant="light" onClick={() => setEditing(true)}>
              {own ? 'Editar política própria' : 'Definir política própria'}
            </Button>
            {own && (
              <Button
                size="xs"
                variant="subtle"
                color="red"
                loading={remove.isPending}
                onClick={() =>
                  confirmAction({
                    title: 'Remover política própria',
                    message: 'O agente volta a usar a política de patch herdada. Deseja continuar?',
                    confirmLabel: 'Remover',
                    danger: true,
                    onConfirm: () => remove.mutate(),
                  })
                }
              >
                Usar a herdada
              </Button>
            )}
          </Group>
        )}
      </Group>
      {policy.isError && <LoadError error={policy.error} onRetry={() => void policy.refetch()} />}
      {policy.isPending && (
        <Text size="sm" c="dimmed">
          Carregando política...
        </Text>
      )}
      {policy.data &&
        (editing ? (
          <PatchPolicyForm initial={own ?? policy.data.effective} saving={save.isPending} onSave={(p) => save.mutate(p)} onCancel={() => setEditing(false)} />
        ) : (
          <PatchPolicySummary policy={policy.data.effective} />
        ))}
    </Paper>
  );
}
