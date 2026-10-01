import { useState } from 'react';
import { ActionIcon, Anchor, Badge, Button, Group, Modal, Paper, Stack, Switch, Table, Text, Textarea, TextInput, Tooltip } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconCircleCheck, IconCircleOff, IconPencil, IconPlus, IconSitemap, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { policiesApi } from '../../api/monitoring';
import { queryKeys } from '../../api/queryKeys';
import { PERMISSIONS, type PolicyDto, type SavePolicyRequest } from '../../api/types';
import { PATHS, policyPath } from '../../app/paths';
import { hasPermission } from '../../auth/permissions';
import { useMe } from '../../auth/useMe';
import { PageHeader } from '../../components/PageHeader';
import { EmptyRow, LoadError, LoadingRows } from '../../components/TableStates';
import { confirmAction, notifySuccess } from '../../lib/feedback';
import { applyServerErrors } from '../../lib/forms';
import { joinPt } from '../monitoring/tasks/schedule';

const COLUMNS = 6;

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function appliedToText(applied: PolicyDto['appliedTo']): string {
  const parts: string[] = [];
  if (applied.clients) parts.push(plural(applied.clients, 'cliente', 'clientes'));
  if (applied.sites) parts.push(plural(applied.sites, 'site', 'sites'));
  if (applied.agents) parts.push(plural(applied.agents, 'agente', 'agentes'));
  return parts.length ? joinPt(parts) : 'Não aplicada diretamente';
}

export function PolicyEnabledBadge({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <Badge color="teal" variant="light" leftSection={<IconCircleCheck size={12} aria-hidden />}>
      Ativa
    </Badge>
  ) : (
    <Badge color="gray" variant="light" leftSection={<IconCircleOff size={12} aria-hidden />}>
      Desativada
    </Badge>
  );
}

export function PoliciesPage() {
  const { data: me } = useMe();
  const canManage = hasPermission(me, PERMISSIONS.policiesManage);
  const queryClient = useQueryClient();
  const policies = useQuery({ queryKey: queryKeys.policies, queryFn: policiesApi.list });
  const [editing, setEditing] = useState<{ policy: PolicyDto | null } | null>(null);

  const remove = useMutation({
    mutationFn: (policy: PolicyDto) => policiesApi.remove(policy.id),
    onSuccess: (_, policy) => {
      notifySuccess(`Política ${policy.name} excluída.`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.policies });
    },
  });

  return (
    <>
      <PageHeader
        title="Políticas"
        description="Conjuntos de checks, tarefas e regras de atualização aplicados a clientes, sites e agentes."
        actions={
          <>
            <Button component={Link} to={PATHS.policyAssignments} variant="light" leftSection={<IconSitemap size={16} />}>
              Atribuições
            </Button>
            {canManage && (
              <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing({ policy: null })}>
                Nova política
              </Button>
            )}
          </>
        }
      />
      {policies.isError && <LoadError error={policies.error} onRetry={() => void policies.refetch()} />}
      <Paper withBorder>
        <Table.ScrollContainer minWidth={760}>
          <Table verticalSpacing="sm" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Nome</Table.Th>
                <Table.Th w={130}>Situação</Table.Th>
                <Table.Th w={80}>Checks</Table.Th>
                <Table.Th w={80}>Tarefas</Table.Th>
                <Table.Th>Aplicada em</Table.Th>
                <Table.Th w={90} aria-label="Ações" />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {policies.isPending && <LoadingRows columns={COLUMNS} />}
              {policies.isSuccess && policies.data.length === 0 && <EmptyRow columns={COLUMNS} message="Nenhuma política cadastrada." />}
              {policies.data?.map((policy) => (
                <Table.Tr key={policy.id}>
                  <Table.Td>
                    <Anchor component={Link} to={policyPath(policy.id)} fw={500} size="sm">
                      {policy.name}
                    </Anchor>
                    {policy.description && (
                      <Text size="xs" c="dimmed" lineClamp={1}>
                        {policy.description}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <PolicyEnabledBadge enabled={policy.enabled} />
                  </Table.Td>
                  <Table.Td style={{ fontVariantNumeric: 'tabular-nums' }}>{policy.checkCount}</Table.Td>
                  <Table.Td style={{ fontVariantNumeric: 'tabular-nums' }}>{policy.taskCount}</Table.Td>
                  <Table.Td>
                    <Text size="sm">{appliedToText(policy.appliedTo)}</Text>
                  </Table.Td>
                  <Table.Td>
                    {canManage && (
                      <Group gap={4} wrap="nowrap" justify="flex-end">
                        <Tooltip label="Editar">
                          <ActionIcon variant="subtle" color="gray" aria-label={`Editar política ${policy.name}`} onClick={() => setEditing({ policy })}>
                            <IconPencil size={16} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Excluir">
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            aria-label={`Excluir política ${policy.name}`}
                            onClick={() =>
                              confirmAction({
                                title: 'Excluir política',
                                message: `Excluir a política ${policy.name}? Os checks e tarefas dela deixam de valer em todos os agentes.`,
                                confirmLabel: 'Excluir',
                                danger: true,
                                onConfirm: () => remove.mutate(policy),
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
      <PolicyFormModal
        opened={editing !== null}
        current={editing?.policy ?? null}
        onClose={() => setEditing(null)}
      />
    </>
  );
}

interface PolicyFormModalProps {
  opened: boolean;
  current: { id: number; name: string; description: string; enabled: boolean } | null;
  onClose: () => void;
}

export function PolicyFormModal({ opened, current, onClose }: PolicyFormModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} title={current ? 'Editar política' : 'Nova política'} centered>
      {opened && <PolicyForm key={current?.id ?? 'nova'} current={current} onClose={onClose} />}
    </Modal>
  );
}

function PolicyForm({ current, onClose }: Omit<PolicyFormModalProps, 'opened'>) {
  const queryClient = useQueryClient();
  const form = useForm<SavePolicyRequest>({
    initialValues: { name: current?.name ?? '', description: current?.description ?? '', enabled: current?.enabled ?? true },
    validate: { name: (v) => (v.trim() ? null : 'Informe o nome') },
  });
  const save = useMutation({
    mutationFn: (body: SavePolicyRequest) => (current ? policiesApi.update(current.id, body) : policiesApi.create(body)),
    onSuccess: async () => {
      notifySuccess(current ? 'Política atualizada.' : 'Política criada.');
      await queryClient.invalidateQueries({ queryKey: queryKeys.policies });
      onClose();
    },
    onError: (error) => applyServerErrors(form, error),
  });
  return (
    <form
      onSubmit={form.onSubmit((v) => save.mutate({ name: v.name.trim(), description: v.description.trim(), enabled: v.enabled }))}
      noValidate
    >
      <Stack>
        <TextInput label="Nome" required data-autofocus {...form.getInputProps('name')} />
        <Textarea label="Descrição" autosize minRows={2} {...form.getInputProps('description')} />
        <Switch label="Política ativa" {...form.getInputProps('enabled', { type: 'checkbox' })} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            {current ? 'Salvar' : 'Criar'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
