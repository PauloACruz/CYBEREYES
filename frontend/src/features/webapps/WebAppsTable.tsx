import { useState } from 'react';
import { ActionIcon, Anchor, Badge, Group, Modal, Table, Text, Tooltip } from '@mantine/core';
import { IconExternalLink, IconRocket } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { queryKeys } from '../../api/queryKeys';
import type { WebAppDto } from '../../api/types';
import { webAppsApi } from '../../api/webapps';
import { webAppPath } from '../../app/paths';
import { confirmAction } from '../../lib/feedback';
import { RelativeTime } from '../agents/agentDisplay';
import { RunOutput } from './RunOutput';
import { daysUntil, formatLatency, formatUptime, uptimeColor } from './webappFormat';
import { WebAppStatusBadge } from './WebAppStatusBadge';

interface WebAppsTableProps {
  rows: WebAppDto[];
  canRun: boolean;
  emptyText?: string;
}

/** Aplicacoes com status, disponibilidade, resposta, certificado e o atalho de deploy (saida ao vivo num modal). */
export function WebAppsTable({ rows, canRun, emptyText = 'Nenhuma aplicação.' }: WebAppsTableProps) {
  const queryClient = useQueryClient();
  const [deployRun, setDeployRun] = useState<number | null>(null);
  const deploy = useMutation({
    mutationFn: (app: WebAppDto) => webAppsApi.deploy(app.id),
    onSuccess: (started) => {
      setDeployRun(started.id);
      void queryClient.invalidateQueries({ queryKey: queryKeys.appRuns });
    },
  });

  const confirmDeploy = (app: WebAppDto) =>
    confirmAction({
      title: `Deploy de ${app.name}`,
      message: 'Roda o script de deploy da aplicação no servidor agora. A saída aparece em tempo real e fica no histórico.',
      confirmLabel: 'Fazer deploy',
      onConfirm: () => deploy.mutate(app),
    });

  return (
    <>
      <Table.ScrollContainer minWidth={900}>
        <Table verticalSpacing="xs" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={130}>Status</Table.Th>
              <Table.Th>Aplicação</Table.Th>
              <Table.Th w={120}>Disponib. 24 h</Table.Th>
              <Table.Th w={110}>Resposta</Table.Th>
              <Table.Th w={140}>Verificada</Table.Th>
              <Table.Th w={120}>Certificado</Table.Th>
              <Table.Th w={100} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={7}>
                  <Text size="sm" c="dimmed">
                    {emptyText}
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
            {rows.map((app) => {
              const ssl = daysUntil(app.sslExpiresAt);
              return (
                <Table.Tr key={app.id}>
                  <Table.Td>
                    <WebAppStatusBadge status={app.status} />
                  </Table.Td>
                  <Table.Td maw={380}>
                    <Group gap={6} wrap="nowrap">
                      <Anchor component={Link} to={webAppPath(app.id)} size="sm" fw={600}>
                        {app.name}
                      </Anchor>
                      {app.environment && (
                        <Badge size="xs" variant="light" color={/produ/i.test(app.environment) ? 'blue' : 'gray'}>
                          {app.environment}
                        </Badge>
                      )}
                    </Group>
                    <Text size="xs" c={app.status === 'down' ? 'red' : 'dimmed'} truncate="end">
                      {app.status === 'down' && app.lastError ? app.lastError : (app.url ?? app.checkTarget)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" fw={600} c={uptimeColor(app.uptime24h)}>
                      {formatUptime(app.uptime24h)}
                    </Text>
                  </Table.Td>
                  <Table.Td>{formatLatency(app.lastLatencyMs)}</Table.Td>
                  <Table.Td>
                    <RelativeTime value={app.lastCheckedAt} />
                  </Table.Td>
                  <Table.Td>
                    {ssl === null ? (
                      <Text size="sm" c="dimmed">
                        -
                      </Text>
                    ) : (
                      <Text size="sm" c={ssl < 0 ? 'red' : ssl <= 14 ? 'orange' : undefined} fw={ssl <= 14 ? 600 : undefined}>
                        {ssl < 0 ? 'Vencido' : `${ssl} dias`}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} justify="flex-end" wrap="nowrap">
                      {app.url && (
                        <Tooltip label="Abrir o site">
                          <ActionIcon component="a" href={app.url} target="_blank" rel="noreferrer" variant="subtle" color="gray" aria-label={`Abrir ${app.name}`}>
                            <IconExternalLink size={16} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                      {canRun && app.hasDeploy && (
                        <Tooltip label="Fazer deploy">
                          <ActionIcon
                            variant="light"
                            aria-label={`Deploy de ${app.name}`}
                            loading={deploy.isPending && deploy.variables.id === app.id}
                            onClick={() => confirmDeploy(app)}
                          >
                            <IconRocket size={16} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <Modal opened={deployRun !== null} onClose={() => setDeployRun(null)} title="Deploy" size="xl" centered>
        {deployRun !== null && <RunOutput runId={deployRun} canCancel={canRun} maxHeight={560} />}
      </Modal>
    </>
  );
}
