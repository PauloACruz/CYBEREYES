import { Fragment } from 'react';
import { Anchor, Breadcrumbs, Paper, Select, SimpleGrid, Stack, Switch, Table, Text, Title } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { policiesApi } from '../../api/monitoring';
import { queryKeys } from '../../api/queryKeys';
import { PERMISSIONS, type BlockInheritanceRequest, type MonitoringType, type PolicyAssignmentRequest } from '../../api/types';
import { agentPath, PATHS } from '../../app/paths';
import { hasPermission } from '../../auth/permissions';
import { useMe } from '../../auth/useMe';
import { PageHeader } from '../../components/PageHeader';
import { EmptyRow, LoadError, LoadingRows } from '../../components/TableStates';
import { notifySuccess } from '../../lib/feedback';

const NONE = 'none';

interface PolicySelectProps {
  label: string;
  value: number | null;
  options: { value: string; label: string }[];
  disabled: boolean;
  onChange: (policyId: number | null) => void;
  hideLabel?: boolean;
}

function PolicySelect({ label, value, options, disabled, onChange, hideLabel }: PolicySelectProps) {
  return (
    <Select
      label={hideLabel ? undefined : label}
      aria-label={label}
      size={hideLabel ? 'xs' : 'sm'}
      allowDeselect={false}
      data={[{ value: NONE, label: 'Nenhuma' }, ...options]}
      value={value === null ? NONE : String(value)}
      disabled={disabled}
      onChange={(v) => {
        const next = !v || v === NONE ? null : Number(v);
        if (next !== value) onChange(next);
      }}
    />
  );
}

export function PolicyAssignmentsPage() {
  const { data: me } = useMe();
  const canManage = hasPermission(me, PERMISSIONS.policiesManage);
  const queryClient = useQueryClient();
  const policies = useQuery({ queryKey: queryKeys.policies, queryFn: policiesApi.list });
  const assignments = useQuery({ queryKey: queryKeys.policyAssignments, queryFn: policiesApi.assignments });
  const options = (policies.data ?? []).map((p) => ({ value: String(p.id), label: p.enabled ? p.name : `${p.name} (desativada)` }));

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.policies });
    void queryClient.invalidateQueries({ queryKey: ['agent-monitoring'] });
  };
  const assign = useMutation({
    mutationFn: (body: PolicyAssignmentRequest) => policiesApi.assign(body),
    onSuccess: () => {
      notifySuccess('Atribuição salva.');
      refresh();
    },
    onError: () => void assignments.refetch(),
  });
  const block = useMutation({
    mutationFn: (body: BlockInheritanceRequest) => policiesApi.blockInheritance(body),
    onSuccess: (_, body) => {
      notifySuccess(body.block ? 'Herança bloqueada.' : 'Herança liberada.');
      refresh();
    },
    onError: () => void assignments.refetch(),
  });
  const disabled = !canManage || assign.isPending || block.isPending;

  const set = (target: PolicyAssignmentRequest['target'], targetId: number | null, monitoringType: MonitoringType | null) => (policyId: number | null) =>
    assign.mutate({ target, targetId, monitoringType, policyId });

  const data = assignments.data;
  const columns = 4;

  return (
    <>
      <Breadcrumbs mb="xs">
        <Anchor component={Link} to={PATHS.policies} size="sm">
          Políticas
        </Anchor>
        <Text size="sm">Atribuições</Text>
      </Breadcrumbs>
      <PageHeader
        title="Atribuições de políticas"
        description="Valem juntas, da mais específica para a mais geral: agente, site, cliente e global. Bloquear a herança ignora os níveis acima."
      />
      {(assignments.isError || policies.isError) && (
        <LoadError
          error={assignments.error ?? policies.error}
          onRetry={() => {
            void assignments.refetch();
            void policies.refetch();
          }}
        />
      )}
      <Stack gap="xl">
        <section aria-labelledby="atribuicao-global">
          <Title order={3} id="atribuicao-global" mb="xs">
            Global
          </Title>
          <Paper withBorder p="md">
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <PolicySelect
                label="Política global de servidores"
                value={data?.globalServer ?? null}
                options={options}
                disabled={disabled || !data}
                onChange={set('global', null, 'server')}
              />
              <PolicySelect
                label="Política global de estações"
                value={data?.globalWorkstation ?? null}
                options={options}
                disabled={disabled || !data}
                onChange={set('global', null, 'workstation')}
              />
            </SimpleGrid>
          </Paper>
        </section>

        <section aria-labelledby="atribuicao-clientes">
          <Title order={3} id="atribuicao-clientes" mb="xs">
            Clientes e sites
          </Title>
          <Paper withBorder>
            <Table.ScrollContainer minWidth={820}>
              <Table verticalSpacing="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Cliente ou site</Table.Th>
                    <Table.Th w={230}>Servidores</Table.Th>
                    <Table.Th w={230}>Estações</Table.Th>
                    <Table.Th w={150}>Bloquear herança</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {assignments.isPending && <LoadingRows columns={columns} rows={3} />}
                  {data && data.clients.length === 0 && <EmptyRow columns={columns} message="Nenhum cliente cadastrado." />}
                  {data?.clients.map((client) => (
                    <Fragment key={client.id}>
                      <Table.Tr bg="var(--mantine-color-default-hover)">
                        <Table.Td fw={600}>{client.name}</Table.Td>
                        <Table.Td>
                          <PolicySelect
                            hideLabel
                            label={`Política de servidores do cliente ${client.name}`}
                            value={client.serverPolicyId}
                            options={options}
                            disabled={disabled}
                            onChange={set('client', client.id, 'server')}
                          />
                        </Table.Td>
                        <Table.Td>
                          <PolicySelect
                            hideLabel
                            label={`Política de estações do cliente ${client.name}`}
                            value={client.workstationPolicyId}
                            options={options}
                            disabled={disabled}
                            onChange={set('client', client.id, 'workstation')}
                          />
                        </Table.Td>
                        <Table.Td>
                          <Switch
                            aria-label={`Bloquear herança no cliente ${client.name}`}
                            checked={client.blockPolicyInheritance}
                            disabled={disabled}
                            onChange={(e) => block.mutate({ target: 'client', targetId: client.id, block: e.currentTarget.checked })}
                          />
                        </Table.Td>
                      </Table.Tr>
                      {data.sites
                        .filter((s) => s.clientId === client.id)
                        .map((site) => (
                          <Table.Tr key={`site-${site.id}`}>
                            <Table.Td pl="xl">{site.name}</Table.Td>
                            <Table.Td>
                              <PolicySelect
                                hideLabel
                                label={`Política de servidores do site ${site.name}`}
                                value={site.serverPolicyId}
                                options={options}
                                disabled={disabled}
                                onChange={set('site', site.id, 'server')}
                              />
                            </Table.Td>
                            <Table.Td>
                              <PolicySelect
                                hideLabel
                                label={`Política de estações do site ${site.name}`}
                                value={site.workstationPolicyId}
                                options={options}
                                disabled={disabled}
                                onChange={set('site', site.id, 'workstation')}
                              />
                            </Table.Td>
                            <Table.Td>
                              <Switch
                                aria-label={`Bloquear herança no site ${site.name}`}
                                checked={site.blockPolicyInheritance}
                                disabled={disabled}
                                onChange={(e) => block.mutate({ target: 'site', targetId: site.id, block: e.currentTarget.checked })}
                              />
                            </Table.Td>
                          </Table.Tr>
                        ))}
                    </Fragment>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Paper>
        </section>

        {data && data.agents.length > 0 && (
          <section aria-labelledby="atribuicao-agentes">
            <Title order={3} id="atribuicao-agentes" mb="xs">
              Agentes com política própria ou herança bloqueada
            </Title>
            <Paper withBorder>
              <Table.ScrollContainer minWidth={600}>
                <Table verticalSpacing="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Agente</Table.Th>
                      <Table.Th w={260}>Política</Table.Th>
                      <Table.Th w={150}>Bloquear herança</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {data.agents.map((agent) => (
                      <Table.Tr key={agent.id}>
                        <Table.Td>
                          <Anchor component={Link} to={agentPath(agent.id)} size="sm">
                            {agent.hostname}
                          </Anchor>
                        </Table.Td>
                        <Table.Td>
                          <PolicySelect
                            hideLabel
                            label={`Política do agente ${agent.hostname}`}
                            value={agent.policyId}
                            options={options}
                            disabled={disabled}
                            onChange={set('agent', agent.id, null)}
                          />
                        </Table.Td>
                        <Table.Td>
                          <Switch
                            aria-label={`Bloquear herança no agente ${agent.hostname}`}
                            checked={agent.blockPolicyInheritance}
                            disabled={disabled}
                            onChange={(e) => block.mutate({ target: 'agent', targetId: agent.id, block: e.currentTarget.checked })}
                          />
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Paper>
          </section>
        )}
      </Stack>
    </>
  );
}
