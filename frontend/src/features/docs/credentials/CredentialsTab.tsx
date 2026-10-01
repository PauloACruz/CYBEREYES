import { useState } from 'react';
import { ActionIcon, Alert, Anchor, Button, Group, Paper, Table, Text, TextInput, Tooltip } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconLock, IconPencil, IconPlus, IconSearch, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ApiError } from '../../../api/client';
import { credentialsApi } from '../../../api/docs';
import { queryKeys } from '../../../api/queryKeys';
import type { CredentialDto, ListCredentialsParams } from '../../../api/types';
import { assetPath } from '../../../app/paths';
import { EmptyRow, LoadError, LoadingRows } from '../../../components/TableStates';
import { confirmAction, notifySuccess } from '../../../lib/feedback';
import { RelativeTime } from '../../agents/agentDisplay';
import { CredentialFormModal } from './CredentialFormModal';
import { RevealSecret } from './RevealSecret';

const COLUMNS = 6;

type Editing = { mode: 'new' } | { mode: 'edit'; credential: CredentialDto } | null;

interface CredentialsTabProps {
  clientId: number | undefined;
  canManage: boolean;
  canReveal: boolean;
}

function isVaultDisabled(error: unknown): boolean {
  return error instanceof ApiError && error.status === 503 && error.code === 'VAULT_DISABLED';
}

export function CredentialsTab({ clientId, canManage, canReveal }: CredentialsTabProps) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Editing>(null);
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search.trim(), 300);
  const params: ListCredentialsParams = { clientId, search: debounced || undefined };
  const credentials = useQuery({
    queryKey: queryKeys.credentialList(params),
    queryFn: () => credentialsApi.list(params, { silent: true }),
    retry: (count, error) => !isVaultDisabled(error) && count < 2,
  });

  const remove = useMutation({
    mutationFn: (id: number) => credentialsApi.remove(id),
    onSuccess: () => {
      notifySuccess('Credencial excluída.');
      void queryClient.invalidateQueries({ queryKey: queryKeys.credentials });
      void queryClient.invalidateQueries({ queryKey: queryKeys.assetSheets });
    },
  });

  if (isVaultDisabled(credentials.error)) {
    return (
      <Alert color="yellow" icon={<IconLock size={18} />} title="Cofre de credenciais desativado">
        O servidor não tem a chave do cofre configurada (variável VAULT_KEY). Peça ao administrador para configurá-la e reiniciar a API.
      </Alert>
    );
  }

  return (
    <>
      <Group justify="space-between" mb="sm" wrap="wrap">
        <TextInput
          placeholder="Nome, usuário ou endereço"
          aria-label="Buscar credenciais"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          w={280}
        />
        {canManage && (
          <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing({ mode: 'new' })}>
            Nova credencial
          </Button>
        )}
      </Group>
      {credentials.isError && <LoadError error={credentials.error} onRetry={() => void credentials.refetch()} />}
      <Paper withBorder>
        <Table.ScrollContainer minWidth={950}>
          <Table verticalSpacing="xs" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Nome</Table.Th>
                <Table.Th w={160}>Usuário</Table.Th>
                <Table.Th w={180}>Ativo</Table.Th>
                <Table.Th w={150}>Atualizada</Table.Th>
                <Table.Th w={260}>Senha</Table.Th>
                <Table.Th w={80} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {credentials.isPending && <LoadingRows columns={COLUMNS} />}
              {credentials.data && credentials.data.length === 0 && <EmptyRow columns={COLUMNS} message="Nenhuma credencial cadastrada." />}
              {credentials.data?.map((credential) => (
                <Table.Tr key={credential.id}>
                  <Table.Td>
                    <Text size="sm" fw={600}>
                      {credential.name}
                    </Text>
                    <Text size="xs" c="dimmed" lineClamp={1}>
                      {credential.clientName}
                      {credential.url ? ` · ${credential.url}` : ''}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" ff="monospace">
                      {credential.username ?? ''}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    {credential.assetId ? (
                      <Anchor component={Link} to={assetPath(credential.assetId)} size="sm">
                        {credential.assetName ?? `Ativo #${credential.assetId}`}
                      </Anchor>
                    ) : null}
                  </Table.Td>
                  <Table.Td>
                    <RelativeTime value={credential.updatedAt} />
                    <Text size="xs" c="dimmed">
                      por {credential.updatedBy}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    {canReveal ? (
                      <RevealSecret credentialId={credential.id} name={credential.name} />
                    ) : (
                      <Text size="sm" c="dimmed">
                        ••••••••
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {canManage && (
                      <Group gap={4} wrap="nowrap" justify="flex-end">
                        <Tooltip label="Editar">
                          <ActionIcon variant="subtle" color="gray" aria-label={`Editar ${credential.name}`} onClick={() => setEditing({ mode: 'edit', credential })}>
                            <IconPencil size={16} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Excluir">
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            aria-label={`Excluir ${credential.name}`}
                            onClick={() =>
                              confirmAction({
                                title: 'Excluir credencial',
                                message: `Excluir ${credential.name}? O segredo será apagado do cofre.`,
                                confirmLabel: 'Excluir',
                                danger: true,
                                onConfirm: () => remove.mutate(credential.id),
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
        <CredentialFormModal
          opened={editing !== null}
          onClose={() => setEditing(null)}
          credential={editing?.mode === 'edit' ? editing.credential : undefined}
          defaultClientId={clientId}
        />
      )}
    </>
  );
}
