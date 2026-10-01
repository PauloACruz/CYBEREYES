import { Fragment, useMemo, useState } from 'react';
import { ActionIcon, Anchor, Button, Group, Paper, Stack, Table, Text, Tooltip } from '@mantine/core';
import { IconChevronDown, IconChevronRight, IconExternalLink, IconPencil, IconPlayerPlay, IconPlus, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { checksApi } from '../../../api/monitoring';
import { queryKeys } from '../../../api/queryKeys';
import { scriptsApi } from '../../../api/scripts';
import { PERMISSIONS, type AgentCheckDto, type AgentDetail, type CheckDto } from '../../../api/types';
import { policyPath } from '../../../app/paths';
import { hasPermission } from '../../../auth/permissions';
import { useMe } from '../../../auth/useMe';
import { EmptyRow, LoadError, LoadingRows } from '../../../components/TableStates';
import { confirmAction, notifySuccess } from '../../../lib/feedback';
import { formatDateTime } from '../../../lib/format';
import { parseDisks } from '../agentData';
import { RelativeTime } from '../agentDisplay';
import { CHECK_TYPE_LABEL, checkDisplayName } from '../../monitoring/checks/checkForm';
import { CheckFormModal } from '../../monitoring/checks/CheckFormModal';
import { CheckStatusBadge, InheritedBadge } from '../../monitoring/MonitoringBadges';
import { CheckHistoryPanel } from './CheckHistoryPanel';

const COLUMNS = 8;

export function ChecksTab({ agent }: { agent: AgentDetail }) {
  const { data: me } = useMe();
  const canManage = hasPermission(me, PERMISSIONS.checksManage);
  const canRun = hasPermission(me, PERMISSIONS.agentsRun);
  const canViewScripts = hasPermission(me, PERMISSIONS.scriptsView);
  const queryClient = useQueryClient();
  const checks = useQuery({ queryKey: queryKeys.agentChecks(agent.id), queryFn: () => checksApi.forAgent(agent.id) });
  const scripts = useQuery({ queryKey: queryKeys.scripts, queryFn: scriptsApi.list, enabled: canViewScripts });
  const scriptNames = useMemo(() => new Map((scripts.data ?? []).map((s) => [s.id, s.name])), [scripts.data]);
  const disks = useMemo(() => (parseDisks(agent.disks) ?? []).map((d) => d.device), [agent.disks]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ check: CheckDto | null } | null>(null);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: queryKeys.agentChecks(agent.id) });

  const runAll = useMutation({
    mutationFn: () => checksApi.runAll(agent.id),
    onSuccess: () => {
      notifySuccess('O agente vai executar os checks agora. Os resultados aparecem em instantes.', 'Checks solicitados');
      setTimeout(refresh, 5000);
    },
  });

  const remove = useMutation({
    mutationFn: (check: CheckDto) => checksApi.remove(check.id),
    onSuccess: () => {
      notifySuccess('Check excluído.');
      refresh();
    },
  });

  const rows = checks.data ?? [];
  const failing = rows.filter((r) => r.result?.status === 'failing').length;

  const nameOf = (item: AgentCheckDto) =>
    checkDisplayName(item.check, item.check.scriptId !== null ? scriptNames.get(item.check.scriptId) : undefined);

  return (
    <Stack>
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          {checks.isSuccess ? `${rows.length} ${rows.length === 1 ? 'check' : 'checks'}, ${failing} com falha` : 'Carregando checks...'}
        </Text>
        <Group gap="sm">
          {canRun && (
            <Button variant="light" leftSection={<IconPlayerPlay size={16} />} loading={runAll.isPending} onClick={() => runAll.mutate()}>
              Executar checks agora
            </Button>
          )}
          {canManage && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing({ check: null })}>
              Novo check
            </Button>
          )}
        </Group>
      </Group>
      {checks.isError && <LoadError error={checks.error} onRetry={() => void checks.refetch()} />}
      <Paper withBorder>
        <Table.ScrollContainer minWidth={900}>
          <Table verticalSpacing="xs" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={40} aria-label="Expandir" />
                <Table.Th>Check</Table.Th>
                <Table.Th w={160}>Tipo</Table.Th>
                <Table.Th w={150}>Status</Table.Th>
                <Table.Th>Mais informações</Table.Th>
                <Table.Th w={130}>Última execução</Table.Th>
                <Table.Th w={70}>Falhas</Table.Th>
                <Table.Th w={90} aria-label="Ações" />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {checks.isPending && <LoadingRows columns={COLUMNS} />}
              {checks.isSuccess && rows.length === 0 && <EmptyRow columns={COLUMNS} message="Nenhum check configurado neste agente." />}
              {rows.map((item) => {
                const { check, result } = item;
                const open = expanded === check.id;
                const name = nameOf(item);
                return (
                  <Fragment key={check.id}>
                    <Table.Tr>
                      <Table.Td>
                        <ActionIcon
                          variant="subtle"
                          color="gray"
                          size="sm"
                          aria-label={open ? `Recolher histórico de ${name}` : `Ver histórico de ${name}`}
                          aria-expanded={open}
                          onClick={() => setExpanded(open ? null : check.id)}
                        >
                          {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                        </ActionIcon>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={6} wrap="nowrap">
                          <Text size="sm" fw={500}>
                            {name}
                          </Text>
                          {item.inherited && <InheritedBadge policyName={item.policyName} />}
                        </Group>
                        {item.inherited && item.policyName && (
                          <Text size="xs" c="dimmed">
                            Política {item.policyName}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>{CHECK_TYPE_LABEL[check.checkType]}</Table.Td>
                      <Table.Td>
                        <CheckStatusBadge status={result?.status ?? null} severity={result?.alertSeverity ?? null} />
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" lineClamp={2}>
                          {result?.moreInfo || 'Sem informações'}
                        </Text>
                      </Table.Td>
                      <Table.Td>{result?.lastRun ? <RelativeTime value={result.lastRun} /> : formatDateTime(null)}</Table.Td>
                      <Table.Td style={{ fontVariantNumeric: 'tabular-nums' }}>{result?.failCount ?? 0}</Table.Td>
                      <Table.Td>
                        <Group gap={4} wrap="nowrap" justify="flex-end">
                          {item.inherited && check.policyId !== null && (
                            <Tooltip label="Editar na política">
                              <Anchor component={Link} to={policyPath(check.policyId)} aria-label={`Abrir a política de ${name}`}>
                                <IconExternalLink size={16} />
                              </Anchor>
                            </Tooltip>
                          )}
                          {!item.inherited && canManage && (
                            <>
                              <Tooltip label="Editar">
                                <ActionIcon variant="subtle" color="gray" aria-label={`Editar check ${name}`} onClick={() => setEditing({ check })}>
                                  <IconPencil size={16} />
                                </ActionIcon>
                              </Tooltip>
                              <Tooltip label="Excluir">
                                <ActionIcon
                                  variant="subtle"
                                  color="red"
                                  aria-label={`Excluir check ${name}`}
                                  onClick={() =>
                                    confirmAction({
                                      title: 'Excluir check',
                                      message: `Excluir o check ${name}? Os alertas ativos dele serão resolvidos.`,
                                      confirmLabel: 'Excluir',
                                      danger: true,
                                      onConfirm: () => remove.mutate(check),
                                    })
                                  }
                                >
                                  <IconTrash size={16} />
                                </ActionIcon>
                              </Tooltip>
                            </>
                          )}
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                    {open && (
                      <Table.Tr>
                        <Table.Td colSpan={COLUMNS}>
                          <CheckHistoryPanel item={item} agentId={agent.id} />
                        </Table.Td>
                      </Table.Tr>
                    )}
                  </Fragment>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
      {canManage && (
        <CheckFormModal
          opened={editing !== null}
          onClose={() => setEditing(null)}
          current={editing?.check ?? null}
          owner={{ agentId: agent.id, policyId: null }}
          plat={agent.plat}
          diskSuggestions={disks}
          onSaved={refresh}
        />
      )}
    </Stack>
  );
}
