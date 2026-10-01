import { ActionIcon, Badge, Button, Code, Paper, Table, Tooltip } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiKeysApi } from '../../api/apikeys';
import type { ApiKeyDto } from '../../api/types';
import { PageHeader } from '../../components/PageHeader';
import { EmptyRow, LoadError, LoadingRows } from '../../components/TableStates';
import { confirmAction, notifySuccess } from '../../lib/feedback';
import { formatDate, formatDateTime } from '../../lib/format';
import { CreateApiKeyModal } from './CreateApiKeyModal';

const COLUMNS = 7;

function isExpired(key: ApiKeyDto): boolean {
  return key.expiresAt !== null && new Date(key.expiresAt).getTime() < Date.now();
}

export function ApiKeysPage() {
  const queryClient = useQueryClient();
  const [createOpened, createModal] = useDisclosure(false);
  const keys = useQuery({ queryKey: ['apikeys'], queryFn: apiKeysApi.list });

  const revoke = useMutation({
    mutationFn: (key: ApiKeyDto) => apiKeysApi.revoke(key.id),
    onSuccess: async (_, key) => {
      notifySuccess(`Chave ${key.name} revogada.`);
      await queryClient.invalidateQueries({ queryKey: ['apikeys'] });
    },
  });

  return (
    <>
      <PageHeader
        title="Chaves de API"
        description="Chaves para integrações acessarem a API pelo cabeçalho X-API-KEY."
        actions={
          <Button leftSection={<IconPlus size={16} />} onClick={createModal.open}>
            Nova chave
          </Button>
        }
      />
      {keys.isError && <LoadError error={keys.error} onRetry={() => void keys.refetch()} />}
      <Paper withBorder>
        <Table.ScrollContainer minWidth={820}>
          <Table striped highlightOnHover verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Nome</Table.Th>
                <Table.Th>Prefixo</Table.Th>
                <Table.Th>Usuário</Table.Th>
                <Table.Th>Validade</Table.Th>
                <Table.Th>Criada em</Table.Th>
                <Table.Th>Último uso</Table.Th>
                <Table.Th w={60}>
                  <span className="mantine-visually-hidden">Ações</span>
                </Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {keys.isPending && <LoadingRows columns={COLUMNS} rows={3} />}
              {keys.data?.length === 0 && <EmptyRow columns={COLUMNS} message="Nenhuma chave de API criada." />}
              {keys.data?.map((key) => (
                <Table.Tr key={key.id}>
                  <Table.Td fw={500}>{key.name}</Table.Td>
                  <Table.Td>
                    <Code>{key.prefix}</Code>
                  </Table.Td>
                  <Table.Td>{key.username}</Table.Td>
                  <Table.Td>
                    {isExpired(key) ? (
                      <Badge color="red" variant="light" size="sm">
                        Expirada em {formatDate(key.expiresAt)}
                      </Badge>
                    ) : (
                      formatDate(key.expiresAt)
                    )}
                  </Table.Td>
                  <Table.Td>{formatDateTime(key.createdAt)}</Table.Td>
                  <Table.Td>{formatDateTime(key.lastUsedAt)}</Table.Td>
                  <Table.Td>
                    <Tooltip label="Revogar">
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        aria-label={`Revogar ${key.name}`}
                        onClick={() =>
                          confirmAction({
                            title: 'Revogar chave de API',
                            message: `As integrações que usam a chave ${key.name} deixarão de funcionar imediatamente. Deseja revogar?`,
                            confirmLabel: 'Revogar',
                            danger: true,
                            onConfirm: () => revoke.mutate(key),
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
      <CreateApiKeyModal opened={createOpened} onClose={createModal.close} />
    </>
  );
}
