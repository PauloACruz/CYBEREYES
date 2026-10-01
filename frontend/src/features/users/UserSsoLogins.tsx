import { ActionIcon, Badge, Group, Paper, Skeleton, Stack, Text, Tooltip } from '@mantine/core';
import { IconLinkOff } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import type { UserDto, UserSsoLogin } from '../../api/types';
import { usersApi } from '../../api/users';
import { LoadError } from '../../components/TableStates';
import { confirmAction, notifySuccess } from '../../lib/feedback';

interface UserSsoLoginsProps {
  user: UserDto;
  canManage: boolean;
}

/** Vinculos com provedores de SSO e indicacao de senha local (GET /api/users/{id}). */
export function UserSsoLogins({ user, canManage }: UserSsoLoginsProps) {
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: queryKeys.userDetail(user.id), queryFn: () => usersApi.get(user.id) });

  const unlink = useMutation({
    mutationFn: (login: UserSsoLogin) => usersApi.removeSsoLogin(user.id, login.providerId),
    onSuccess: async (_, login) => {
      notifySuccess(`Vínculo com ${login.providerName} removido.`);
      await queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const logins = detail.data?.ssoLogins ?? [];
  const noPassword = detail.data?.hasPassword === false;

  return (
    <Paper withBorder p="sm" component="section" aria-labelledby={`sso-logins-${user.id}`}>
      <Group justify="space-between" mb={6}>
        <Text size="sm" fw={500} id={`sso-logins-${user.id}`}>
          Login único (SSO)
        </Text>
        {noPassword && (
          <Badge color="yellow" variant="light">
            Sem senha local
          </Badge>
        )}
      </Group>
      {detail.isPending && <Skeleton height={24} />}
      {detail.isError && <LoadError error={detail.error} onRetry={() => void detail.refetch()} />}
      {detail.isSuccess && (
        <Stack gap={6}>
          {noPassword && (
            <Text size="xs" c="dimmed">
              Este usuário entra somente pelo provedor de identidade. Use "Redefinir senha" para criar uma senha local.
            </Text>
          )}
          {logins.length === 0 && (
            <Text size="sm" c="dimmed">
              Nenhum provedor vinculado.
            </Text>
          )}
          {logins.map((login) => (
            <Group key={login.providerId} justify="space-between" wrap="nowrap">
              <Text size="sm">{login.providerName}</Text>
              {canManage && (
                <Tooltip label="Remover vínculo">
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    aria-label={`Remover vínculo com ${login.providerName}`}
                    loading={unlink.isPending && unlink.variables.providerId === login.providerId}
                    onClick={() =>
                      confirmAction({
                        title: 'Remover vínculo de SSO',
                        message: noPassword && logins.length === 1
                          ? `${user.username} não tem senha local e ficará sem forma de entrar, a menos que o provedor vincule a conta de novo pelo e-mail ou você defina uma senha. Remover o vínculo com ${login.providerName}?`
                          : `Remover o vínculo de ${user.username} com ${login.providerName}?`,
                        confirmLabel: 'Remover vínculo',
                        danger: true,
                        onConfirm: () => unlink.mutate(login),
                      })
                    }
                  >
                    <IconLinkOff size={16} />
                  </ActionIcon>
                </Tooltip>
              )}
            </Group>
          ))}
        </Stack>
      )}
    </Paper>
  );
}
