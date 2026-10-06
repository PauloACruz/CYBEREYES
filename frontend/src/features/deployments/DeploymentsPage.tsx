import { ActionIcon, Badge, Button, Paper, Stack, Table, Text, Tooltip } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deploymentsApi } from '../../api/deployments';
import { queryKeys } from '../../api/queryKeys';
import type { AgentPlat, DeploymentDto } from '../../api/types';
import { CopyField } from '../../components/CopyField';
import { PageHeader } from '../../components/PageHeader';
import { EmptyRow, LoadError, LoadingRows } from '../../components/TableStates';
import { confirmAction, notifySuccess } from '../../lib/feedback';
import { formatDateTime } from '../../lib/format';
import { AGENT_TYPE_LABEL, PLAT_OPTIONS } from '../agents/installOptions';
import { CreateDeploymentModal } from './CreateDeploymentModal';

const COLUMNS = 6;
const COMMAND_ORDER: AgentPlat[] = ['linux', 'darwin', 'windows'];

function platLabel(plat: AgentPlat): string {
  return PLAT_OPTIONS.find((p) => p.value === plat)?.label ?? plat;
}

function isExpired(deployment: DeploymentDto): boolean {
  return new Date(deployment.expiresAt).getTime() < Date.now();
}

export function DeploymentsPage() {
  const queryClient = useQueryClient();
  const [createOpened, createModal] = useDisclosure(false);
  const deployments = useQuery({ queryKey: queryKeys.deployments, queryFn: deploymentsApi.list });

  const remove = useMutation({
    mutationFn: (deployment: DeploymentDto) => deploymentsApi.remove(deployment.id),
    onSuccess: async () => {
      notifySuccess('Implantação excluída.');
      await queryClient.invalidateQueries({ queryKey: queryKeys.deployments });
    },
  });

  return (
    <>
      <PageHeader
        title="Implantações"
        description="Links de instalação com validade, para distribuir o agente em vários computadores de um site."
        actions={
          <Button leftSection={<IconPlus size={16} />} onClick={createModal.open}>
            Nova implantação
          </Button>
        }
      />
      {deployments.isError && <LoadError error={deployments.error} onRetry={() => void deployments.refetch()} />}
      <Paper withBorder>
        <Table.ScrollContainer minWidth={1000}>
          <Table striped verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Cliente / site</Table.Th>
                <Table.Th>Tipo</Table.Th>
                <Table.Th>Validade</Table.Th>
                <Table.Th>Criado por</Table.Th>
                <Table.Th>Comandos</Table.Th>
                <Table.Th w={60}>
                  <span className="mantine-visually-hidden">Ações</span>
                </Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {deployments.isPending && <LoadingRows columns={COLUMNS} rows={3} />}
              {deployments.data?.length === 0 && <EmptyRow columns={COLUMNS} message="Nenhuma implantação criada." />}
              {deployments.data?.map((deployment) => (
                <Table.Tr key={deployment.id}>
                  <Table.Td>
                    <Text size="sm" fw={500}>
                      {deployment.clientName}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {deployment.siteName}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{AGENT_TYPE_LABEL[deployment.agentType]}</Text>
                    <Text size="xs" c="dimmed">
                      {deployment.goArch ?? deployment.goarch}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    {isExpired(deployment) ? (
                      <Badge color="red" variant="light" size="sm">
                        Expirou em {formatDateTime(deployment.expiresAt)}
                      </Badge>
                    ) : (
                      formatDateTime(deployment.expiresAt)
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{deployment.createdBy}</Text>
                    <Text size="xs" c="dimmed">
                      {formatDateTime(deployment.createdAt)}
                    </Text>
                  </Table.Td>
                  <Table.Td maw={520}>
                    <Stack gap={6}>
                      {COMMAND_ORDER.map((plat) => {
                        const command = deployment.commands[plat];
                        if (!command) return null;
                        return (
                          <div key={plat}>
                            <Text size="xs" c="dimmed" fw={600}>
                              {platLabel(plat)}
                            </Text>
                            <CopyField value={command} label={`Copiar comando ${platLabel(plat)}`} />
                          </div>
                        );
                      })}
                    </Stack>
                  </Table.Td>
                  <Table.Td>
                    <Tooltip label="Excluir">
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        aria-label={`Excluir implantação de ${deployment.siteName}`}
                        onClick={() =>
                          confirmAction({
                            title: 'Excluir implantação',
                            message: `Os comandos da implantação de ${deployment.clientName} / ${deployment.siteName} deixarão de funcionar imediatamente. Agentes já instalados não são afetados.`,
                            confirmLabel: 'Excluir',
                            danger: true,
                            onConfirm: () => remove.mutate(deployment),
                          })
                        }
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
      <Text size="xs" c="dimmed" mt="sm">
        Linux: rode no terminal como root ou com um usuário que tenha sudo. macOS: rode com um usuário administrador. Windows: rode no PowerShell como administrador.
      </Text>
      <CreateDeploymentModal opened={createOpened} onClose={createModal.close} />
    </>
  );
}
