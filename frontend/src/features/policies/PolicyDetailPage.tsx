import { useMemo, useState } from 'react';
import { ActionIcon, Anchor, Badge, Breadcrumbs, Button, Center, Group, Loader, Paper, Stack, Table, Text, Title, Tooltip } from '@mantine/core';
import { IconPencil, IconPlus, IconShieldCheck, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { ApiError } from '../../api/client';
import { checksApi, policiesApi, tasksApi } from '../../api/monitoring';
import { queryKeys } from '../../api/queryKeys';
import { scriptsApi } from '../../api/scripts';
import { PERMISSIONS, type CheckDto, type PatchPolicy, type PolicyDetailDto, type TaskDto } from '../../api/types';
import { PATHS } from '../../app/paths';
import { hasPermission } from '../../auth/permissions';
import { useMe } from '../../auth/useMe';
import { NotFound } from '../../components/NotFound';
import { EmptyRow, LoadError } from '../../components/TableStates';
import { confirmAction, notifySuccess } from '../../lib/feedback';
import { CHECK_TYPE_LABEL, checkDisplayName } from '../monitoring/checks/checkForm';
import { CheckFormModal } from '../monitoring/checks/CheckFormModal';
import { AlertChannels, SeverityBadge } from '../monitoring/MonitoringBadges';
import { PatchPolicyForm, PatchPolicySummary } from '../monitoring/patches/PatchPolicyForm';
import { describeSchedule } from '../monitoring/tasks/schedule';
import { TaskFormModal } from '../monitoring/tasks/TaskFormModal';
import { PolicyEnabledBadge, PolicyFormModal } from './PoliciesPage';
import { PageTitle } from '../../components/PageTitle';

export function PolicyDetailPage() {
  const { id: rawId } = useParams();
  const id = Number(rawId);
  const valid = Number.isInteger(id) && id > 0;
  const policy = useQuery({ queryKey: queryKeys.policy(id), queryFn: () => policiesApi.get(id), enabled: valid });

  if (!valid || (policy.error instanceof ApiError && policy.error.status === 404)) return <NotFound />;
  if (policy.isError) return <LoadError error={policy.error} onRetry={() => void policy.refetch()} />;
  if (!policy.data) {
    return (
      <Center py="xl">
        <Loader aria-label="Carregando política" />
      </Center>
    );
  }
  return <PolicyDetailView policy={policy.data} />;
}

function PolicyDetailView({ policy }: { policy: PolicyDetailDto }) {
  const { data: me } = useMe();
  const canManagePolicy = hasPermission(me, PERMISSIONS.policiesManage);
  const [editing, setEditing] = useState(false);
  return (
    <>
      <Breadcrumbs mb="xs">
        <Anchor component={Link} to={PATHS.policies} size="sm">
          Políticas
        </Anchor>
        <Text size="sm">{policy.name}</Text>
      </Breadcrumbs>
      <Group justify="space-between" align="flex-start" mb="lg">
        <PageTitle
          title={policy.name}
          badges={<PolicyEnabledBadge enabled={policy.enabled} />}
          description={policy.description || undefined}
        />
        {canManagePolicy && (
          <Button variant="light" leftSection={<IconPencil size={16} />} onClick={() => setEditing(true)}>
            Editar política
          </Button>
        )}
      </Group>
      <Stack gap="xl">
        <PolicyChecks policy={policy} />
        <PolicyTasks policy={policy} />
        <PolicyPatch policy={policy} />
      </Stack>
      <PolicyFormModal opened={editing} current={policy} onClose={() => setEditing(false)} />
    </>
  );
}

function usePolicyRefresh(policyId: number) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.policy(policyId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.policies, exact: true });
  };
}

function PolicyChecks({ policy }: { policy: PolicyDetailDto }) {
  const { data: me } = useMe();
  const canManage = hasPermission(me, PERMISSIONS.checksManage);
  const canViewScripts = hasPermission(me, PERMISSIONS.scriptsView);
  const scripts = useQuery({ queryKey: queryKeys.scripts, queryFn: scriptsApi.list, enabled: canViewScripts });
  const scriptNames = useMemo(() => new Map((scripts.data ?? []).map((s) => [s.id, s.name])), [scripts.data]);
  const refresh = usePolicyRefresh(policy.id);
  const [editing, setEditing] = useState<{ check: CheckDto | null } | null>(null);
  const remove = useMutation({
    mutationFn: (check: CheckDto) => checksApi.remove(check.id),
    onSuccess: () => {
      notifySuccess('Check excluído.');
      refresh();
    },
  });
  const nameOf = (c: CheckDto) => checkDisplayName(c, c.scriptId !== null ? scriptNames.get(c.scriptId) : undefined);
  const columns = 5;
  return (
    <section aria-labelledby="politica-checks">
      <Group justify="space-between" mb="xs">
        <Title order={3} id="politica-checks">
          Checks
        </Title>
        {canManage && (
          <Button size="sm" leftSection={<IconPlus size={16} />} onClick={() => setEditing({ check: null })}>
            Novo check
          </Button>
        )}
      </Group>
      <Paper withBorder>
        <Table.ScrollContainer minWidth={700}>
          <Table verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Check</Table.Th>
                <Table.Th w={180}>Tipo</Table.Th>
                <Table.Th w={140}>Severidade</Table.Th>
                <Table.Th w={110}>Alertas</Table.Th>
                <Table.Th w={90} aria-label="Ações" />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {policy.checks.length === 0 && <EmptyRow columns={columns} message="Nenhum check nesta política." />}
              {policy.checks.map((check) => (
                <Table.Tr key={check.id}>
                  <Table.Td fw={500}>{nameOf(check)}</Table.Td>
                  <Table.Td>{CHECK_TYPE_LABEL[check.checkType]}</Table.Td>
                  <Table.Td>
                    <SeverityBadge severity={check.alertSeverity} />
                  </Table.Td>
                  <Table.Td>
                    <AlertChannels email={check.emailAlert} webhook={check.webhookAlert} dashboard={check.dashboardAlert} />
                  </Table.Td>
                  <Table.Td>
                    {canManage && (
                      <Group gap={4} wrap="nowrap" justify="flex-end">
                        <Tooltip label="Editar">
                          <ActionIcon variant="subtle" color="gray" aria-label={`Editar check ${nameOf(check)}`} onClick={() => setEditing({ check })}>
                            <IconPencil size={16} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Excluir">
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            aria-label={`Excluir check ${nameOf(check)}`}
                            onClick={() =>
                              confirmAction({
                                title: 'Excluir check',
                                message: `Excluir o check ${nameOf(check)} da política? Ele deixa de valer em todos os agentes que a herdam.`,
                                confirmLabel: 'Excluir',
                                danger: true,
                                onConfirm: () => remove.mutate(check),
                              })
                            }
                          >
                            <IconTrash size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
      {canManage && (
        <CheckFormModal
          opened={editing !== null}
          onClose={() => setEditing(null)}
          current={editing?.check ?? null}
          owner={{ agentId: null, policyId: policy.id }}
          onSaved={refresh}
        />
      )}
    </section>
  );
}

function PolicyTasks({ policy }: { policy: PolicyDetailDto }) {
  const { data: me } = useMe();
  const canManage = hasPermission(me, PERMISSIONS.checksManage);
  const refresh = usePolicyRefresh(policy.id);
  const [editing, setEditing] = useState<{ task: TaskDto | null } | null>(null);
  const checkOptions = policy.checks.map((c) => ({ value: String(c.id), label: checkDisplayName(c) }));
  const checkNames = new Map(policy.checks.map((c) => [c.id, checkDisplayName(c)]));
  const remove = useMutation({
    mutationFn: (task: TaskDto) => tasksApi.remove(task.id),
    onSuccess: () => {
      notifySuccess('Tarefa excluída.');
      refresh();
    },
  });
  const columns = 4;
  return (
    <section aria-labelledby="politica-tarefas">
      <Group justify="space-between" mb="xs">
        <Title order={3} id="politica-tarefas">
          Tarefas
        </Title>
        {canManage && (
          <Button size="sm" leftSection={<IconPlus size={16} />} onClick={() => setEditing({ task: null })}>
            Nova tarefa
          </Button>
        )}
      </Group>
      <Paper withBorder>
        <Table.ScrollContainer minWidth={700}>
          <Table verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Tarefa</Table.Th>
                <Table.Th>Agendamento</Table.Th>
                <Table.Th w={100}>Ações</Table.Th>
                <Table.Th w={90} aria-label="Ações" />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {policy.tasks.length === 0 && <EmptyRow columns={columns} message="Nenhuma tarefa nesta política." />}
              {policy.tasks.map((task) => (
                <Table.Tr key={task.id}>
                  <Table.Td>
                    <Group gap={6}>
                      <Text size="sm" fw={500}>
                        {task.name}
                      </Text>
                      {!task.enabled && (
                        <Badge variant="light" color="gray" size="sm">
                          Desativada
                        </Badge>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{describeSchedule(task, task.assignedCheckId !== null ? checkNames.get(task.assignedCheckId) : undefined)}</Text>
                  </Table.Td>
                  <Table.Td>{task.actions.length}</Table.Td>
                  <Table.Td>
                    {canManage && (
                      <Group gap={4} wrap="nowrap" justify="flex-end">
                        <Tooltip label="Editar">
                          <ActionIcon variant="subtle" color="gray" aria-label={`Editar tarefa ${task.name}`} onClick={() => setEditing({ task })}>
                            <IconPencil size={16} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Excluir">
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            aria-label={`Excluir tarefa ${task.name}`}
                            onClick={() =>
                              confirmAction({
                                title: 'Excluir tarefa',
                                message: `Excluir a tarefa ${task.name} da política?`,
                                confirmLabel: 'Excluir',
                                danger: true,
                                onConfirm: () => remove.mutate(task),
                              })
                            }
                          >
                            <IconTrash size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
      {canManage && (
        <TaskFormModal
          opened={editing !== null}
          onClose={() => setEditing(null)}
          current={editing?.task ?? null}
          owner={{ agentId: null, policyId: policy.id }}
          checkOptions={checkOptions}
          onSaved={refresh}
        />
      )}
    </section>
  );
}

function PolicyPatch({ policy }: { policy: PolicyDetailDto }) {
  const { data: me } = useMe();
  const canManage = hasPermission(me, PERMISSIONS.patchesManage);
  const refresh = usePolicyRefresh(policy.id);
  const [editing, setEditing] = useState(false);
  const save = useMutation({
    mutationFn: (body: PatchPolicy) => policiesApi.savePatchPolicy(policy.id, body),
    onSuccess: () => {
      notifySuccess('Política de patch salva.');
      setEditing(false);
      refresh();
    },
  });
  return (
    <section aria-labelledby="politica-patch">
      <Group justify="space-between" mb="xs">
        <Group gap="xs">
          <IconShieldCheck size={20} aria-hidden />
          <Title order={3} id="politica-patch">
            Política de patch (Windows Update)
          </Title>
        </Group>
        {canManage && !editing && (
          <Button size="sm" variant="light" onClick={() => setEditing(true)}>
            {policy.patchPolicy ? 'Editar' : 'Definir'}
          </Button>
        )}
      </Group>
      <Paper withBorder p="md">
        {editing ? (
          <PatchPolicyForm initial={policy.patchPolicy} saving={save.isPending} onSave={(p) => save.mutate(p)} onCancel={() => setEditing(false)} />
        ) : policy.patchPolicy ? (
          <PatchPolicySummary policy={policy.patchPolicy} />
        ) : (
          <Text size="sm" c="dimmed">
            Esta política não define regras de atualização.
          </Text>
        )}
      </Paper>
    </section>
  );
}
