import { ActionIcon, Badge, Button, Code, List, Paper, Stack, Table, Text, Title, Tooltip } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconPlus, IconRobot, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiKeysApi } from '../../api/apikeys';
import type { ApiKeyDto } from '../../api/types';
import { CopyField } from '../../components/CopyField';
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
        description="Chaves para integrações acessarem a API pelo cabeçalho X-API-KEY (ou Authorization: Bearer)."
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
      <McpCard />
      <CreateApiKeyModal opened={createOpened} onClose={createModal.close} />
    </>
  );
}

/** Endereco do servidor MCP para conectar agentes de IA com uma chave desta lista. */
function McpCard() {
  const url = `${window.location.origin}/api/mcp`;
  return (
    <Paper withBorder p="md" mt="lg" component="section" aria-labelledby="mcp-title">
      <Stack gap="xs">
        <Title order={4} id="mcp-title">
          <IconRobot size={18} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} aria-hidden />
          Agentes de IA (MCP)
        </Title>
        <Text size="sm">
          Agentes de IA (Claude, agentes da Anthropic, Claude Code) atendem chamados e operam as máquinas pelo servidor MCP do Cybereyes, com as
          permissões do usuário dono da chave. Crie a chave logado com um usuário só para o agente, num papel com apenas o que ele pode fazer.
        </Text>
        <CopyField value={url} label="Copiar endereço do MCP" />
        <List size="sm" spacing={4}>
          <List.Item>
            Transporte Streamable HTTP, autenticação <Code>Authorization: Bearer &lt;chave&gt;</Code>.
          </List.Item>
          <List.Item>
            Agentes da Anthropic: credencial <Code>static_bearer</Code> no vault, com o endereço acima.
          </List.Item>
          <List.Item>
            Claude Code: <Code>{`claude mcp add --transport http cybereyes ${url} --header "Authorization: Bearer <chave>"`}</Code>
          </List.Item>
        </List>
      </Stack>
    </Paper>
  );
}
