import { useState } from 'react';
import { ActionIcon, Badge, Button, Group, Paper, Skeleton, Stack, Switch, Table, Text, Title, Tooltip } from '@mantine/core';
import { IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import { ssoApi } from '../../api/sso';
import type { OidcProviderDto, SsoSettingsDto } from '../../api/types';
import { CopyField } from '../../components/CopyField';
import { EmptyRow, LoadError, LoadingRows } from '../../components/TableStates';
import { confirmAction, notifySuccess } from '../../lib/feedback';
import { SsoProviderFormModal } from './SsoProviderFormModal';

const COLUMNS = 5;

export function SsoSection() {
  const queryClient = useQueryClient();
  const providers = useQuery({ queryKey: queryKeys.ssoProviders, queryFn: ssoApi.providers });
  const settings = useQuery({ queryKey: queryKeys.ssoSettings, queryFn: ssoApi.settings });
  const [editing, setEditing] = useState<{ provider: OidcProviderDto | null } | null>(null);

  const saveSettings = useMutation({
    mutationFn: ssoApi.saveSettings,
    onSuccess: (data) => {
      queryClient.setQueryData<SsoSettingsDto>(queryKeys.ssoSettings, data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.ssoLoginOptions });
      notifySuccess(data.disablePasswordLogin ? 'Login por senha desativado (exceto superusuários).' : 'Login por senha reativado.');
    },
  });
  const remove = useMutation({
    mutationFn: (provider: OidcProviderDto) => ssoApi.remove(provider.id),
    onSuccess: async (_, provider) => {
      notifySuccess(`Provedor ${provider.name} excluído.`);
      await queryClient.invalidateQueries({ queryKey: ['sso'] });
      await queryClient.invalidateQueries({ queryKey: queryKeys.ssoLoginOptions });
    },
  });

  const togglePasswordLogin = (disable: boolean) => {
    confirmAction(
      disable
        ? {
            title: 'Desativar login por senha',
            message:
              'Somente os superusuários poderão entrar com usuário e senha. Os demais usuários terão de entrar pelo provedor de identidade. Confirme que o SSO está funcionando antes de continuar.',
            confirmLabel: 'Desativar login por senha',
            danger: true,
            onConfirm: () => saveSettings.mutate({ disablePasswordLogin: true }),
          }
        : {
            title: 'Reativar login por senha',
            message: 'Todos os usuários com senha local voltarão a poder entrar com usuário e senha.',
            confirmLabel: 'Reativar',
            onConfirm: () => saveSettings.mutate({ disablePasswordLogin: false }),
          },
    );
  };

  const redirectUri = providers.data?.[0]?.redirectUri;

  return (
    <section aria-labelledby="sso-title">
      <Group justify="space-between" mb="xs" align="flex-end">
        <div>
          <Title order={3} id="sso-title">
            SSO (OIDC)
          </Title>
          <Text size="sm" c="dimmed">
            Login pelo provedor de identidade da organização. A verificação em duas etapas continua obrigatória.
          </Text>
        </div>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing({ provider: null })}>
          Novo provedor
        </Button>
      </Group>
      <Stack gap="md">
        <Paper withBorder p="md">
          {settings.isError && <LoadError error={settings.error} onRetry={() => void settings.refetch()} />}
          {settings.isPending && <Skeleton height={36} />}
          {settings.data && (
            <Switch
              label="Desativar login por senha (exceto superusuários)"
              description="Os superusuários mantêm o login por senha como acesso de emergência."
              checked={settings.data.disablePasswordLogin}
              disabled={saveSettings.isPending}
              onChange={(e) => togglePasswordLogin(e.currentTarget.checked)}
            />
          )}
          {redirectUri && (
            <Stack gap={4} mt="md">
              <Text size="sm" fw={500}>
                URI de redirecionamento (cadastre no provedor)
              </Text>
              <CopyField value={redirectUri} label="Copiar URI de redirecionamento" />
            </Stack>
          )}
        </Paper>
        {providers.isError && <LoadError error={providers.error} onRetry={() => void providers.refetch()} />}
        <Paper withBorder>
          <Table.ScrollContainer minWidth={760}>
            <Table striped verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Nome</Table.Th>
                  <Table.Th>Authority</Table.Th>
                  <Table.Th>Usuários vinculados</Table.Th>
                  <Table.Th>Situação</Table.Th>
                  <Table.Th w={100}>
                    <span className="mantine-visually-hidden">Ações</span>
                  </Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {providers.isPending && <LoadingRows columns={COLUMNS} rows={2} />}
                {providers.isSuccess && providers.data.length === 0 && <EmptyRow columns={COLUMNS} message="Nenhum provedor de identidade configurado." />}
                {providers.data?.map((provider) => (
                  <Table.Tr key={provider.id}>
                    <Table.Td fw={500}>{provider.name}</Table.Td>
                    <Table.Td style={{ wordBreak: 'break-all' }}>{provider.authority}</Table.Td>
                    <Table.Td>{provider.userCount}</Table.Td>
                    <Table.Td>
                      <Group gap={4}>
                        <Badge color={provider.enabled ? 'teal' : 'gray'} variant="light">
                          {provider.enabled ? 'Ativo' : 'Inativo'}
                        </Badge>
                        {!provider.hasClientSecret && (
                          <Badge color="yellow" variant="light">
                            Sem segredo
                          </Badge>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4} wrap="nowrap" justify="flex-end">
                        <Tooltip label="Editar">
                          <ActionIcon variant="subtle" color="gray" aria-label={`Editar provedor ${provider.name}`} onClick={() => setEditing({ provider })}>
                            <IconPencil size={16} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Excluir">
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            aria-label={`Excluir provedor ${provider.name}`}
                            onClick={() =>
                              confirmAction({
                                title: 'Excluir provedor',
                                message:
                                  provider.userCount > 0
                                    ? `Excluir o provedor ${provider.name}? ${provider.userCount} usuário(s) vinculado(s) não poderão mais entrar por ele.`
                                    : `Excluir o provedor ${provider.name}?`,
                                confirmLabel: 'Excluir',
                                danger: true,
                                onConfirm: () => remove.mutate(provider),
                              })
                            }
                          >
                            <IconTrash size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      </Stack>
      <SsoProviderFormModal opened={editing !== null} provider={editing?.provider ?? null} onClose={() => setEditing(null)} />
    </section>
  );
}
