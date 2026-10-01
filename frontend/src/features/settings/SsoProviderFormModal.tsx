import { Alert, Button, Group, Modal, PasswordInput, Select, SimpleGrid, Stack, Switch, TagsInput, Text, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconPlugConnected } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import { rolesApi } from '../../api/roles';
import { ssoApi } from '../../api/sso';
import type { OidcProviderDto, SaveOidcProvider } from '../../api/types';
import { ApiErrorAlert } from '../../components/ApiErrorAlert';
import { CopyField } from '../../components/CopyField';
import { notifySuccess } from '../../lib/feedback';
import { applyServerErrors } from '../../lib/forms';
import { validateAuthority, validateDomains } from './ssoForm';

interface SsoProviderFormModalProps {
  opened: boolean;
  provider: OidcProviderDto | null;
  onClose: () => void;
}

export function SsoProviderFormModal({ opened, provider, onClose }: SsoProviderFormModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} title={provider ? `Editar provedor ${provider.name}` : 'Novo provedor OIDC'} size="xl" centered>
      {opened && <ProviderForm key={provider?.id ?? 'novo'} provider={provider} onClose={onClose} />}
    </Modal>
  );
}

interface ProviderFormValues {
  name: string;
  authority: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  usernameClaim: string;
  linkByEmail: boolean;
  autoProvision: boolean;
  defaultRoleId: string | null;
  allowedDomains: string[];
  trustProviderMfa: boolean;
  enabled: boolean;
}

function ProviderForm({ provider, onClose }: { provider: OidcProviderDto | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const isEdit = provider !== null;
  const roles = useQuery({ queryKey: queryKeys.roleOptions, queryFn: () => rolesApi.options() });

  const form = useForm<ProviderFormValues>({
    initialValues: {
      name: provider?.name ?? '',
      authority: provider?.authority ?? '',
      clientId: provider?.clientId ?? '',
      clientSecret: '',
      scopes: provider?.scopes ?? 'openid profile email',
      usernameClaim: provider?.usernameClaim ?? 'preferred_username',
      linkByEmail: provider?.linkByEmail ?? true,
      autoProvision: provider?.autoProvision ?? false,
      defaultRoleId: provider?.defaultRoleId ?? null,
      allowedDomains: provider?.allowedDomains ?? [],
      trustProviderMfa: provider?.trustProviderMfa ?? false,
      enabled: provider?.enabled ?? true,
    },
    validate: {
      name: (v) => (!v.trim() ? 'Informe o nome' : v.trim().length > 100 ? 'Use no máximo 100 caracteres' : null),
      authority: (v) => validateAuthority(v),
      clientId: (v) => (v.trim() ? null : 'Informe o client ID'),
      clientSecret: (v) => ((isEdit && provider.hasClientSecret) || v ? null : 'Informe o segredo do cliente'),
      scopes: (v) => (v.trim().split(/\s+/).includes('openid') ? null : 'Inclua o escopo openid'),
      usernameClaim: (v) => (v.trim() ? null : 'Informe a claim do nome de usuário'),
      allowedDomains: (v) => validateDomains(v),
    },
  });

  const save = useMutation({
    mutationFn: (body: SaveOidcProvider) => (provider ? ssoApi.update(provider.id, body) : ssoApi.create(body)),
    onSuccess: async () => {
      notifySuccess(isEdit ? 'Provedor atualizado.' : 'Provedor criado. Cadastre a URI de redirecionamento no provedor.');
      await queryClient.invalidateQueries({ queryKey: ['sso'] });
      await queryClient.invalidateQueries({ queryKey: queryKeys.ssoLoginOptions });
      onClose();
    },
    onError: (error) => applyServerErrors(form, error),
  });

  const test = useMutation({ mutationFn: (authority: string) => ssoApi.test(authority) });

  const submit = form.onSubmit((v) => {
    const body: SaveOidcProvider = {
      name: v.name.trim(),
      authority: v.authority.trim(),
      clientId: v.clientId.trim(),
      scopes: v.scopes.trim().replace(/\s+/g, ' '),
      usernameClaim: v.usernameClaim.trim(),
      linkByEmail: v.linkByEmail,
      autoProvision: v.autoProvision,
      defaultRoleId: v.defaultRoleId,
      allowedDomains: v.allowedDomains.map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean),
      trustProviderMfa: v.trustProviderMfa,
      enabled: v.enabled,
    };
    // Segredo em branco na edicao: o campo nao vai no corpo e o servidor mantem o atual.
    if (v.clientSecret) body.clientSecret = v.clientSecret;
    save.mutate(body);
  });

  const runTest = () => {
    const error = validateAuthority(form.values.authority);
    if (error) {
      form.setFieldError('authority', error);
      return;
    }
    test.mutate(form.values.authority.trim());
  };

  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label="Nome" description="Aparece no botão da tela de login" required maxLength={100} data-autofocus {...form.getInputProps('name')} />
          <TextInput
            label="Authority"
            description="Endereço do emissor (https); a descoberta usa /.well-known/openid-configuration"
            placeholder="https://login.exemplo.com/realms/empresa"
            required
            {...form.getInputProps('authority')}
          />
          <TextInput label="Client ID" required autoComplete="off" {...form.getInputProps('clientId')} />
          <PasswordInput
            label="Segredo do cliente"
            required={!isEdit || !provider.hasClientSecret}
            autoComplete="new-password"
            description={isEdit && provider.hasClientSecret ? 'Deixe em branco para manter o segredo atual' : undefined}
            {...form.getInputProps('clientSecret')}
          />
          <TextInput label="Escopos" description="Separados por espaço" {...form.getInputProps('scopes')} />
          <TextInput label="Claim do nome de usuário" description="Usada ao criar usuários automaticamente" {...form.getInputProps('usernameClaim')} />
        </SimpleGrid>

        <Group gap="sm">
          <Button variant="light" leftSection={<IconPlugConnected size={16} />} loading={test.isPending} onClick={runTest}>
            Testar descoberta
          </Button>
        </Group>
        <div aria-live="polite">
          {test.isError && <ApiErrorAlert error={test.error} />}
          {test.data && test.data.ok && (
            <Alert color="teal" variant="light" title="Descoberta lida com sucesso">
              <Text size="sm" style={{ wordBreak: 'break-all' }}>
                Emissor: {test.data.issuer ?? 'não informado'}
              </Text>
              <Text size="sm" style={{ wordBreak: 'break-all' }}>
                Autorização: {test.data.authorizationEndpoint ?? 'não informado'}
              </Text>
            </Alert>
          )}
          {test.data && !test.data.ok && (
            <Alert color="red" variant="light" title="Falha ao ler a descoberta">
              {test.data.error ?? 'O provedor não respondeu como esperado.'}
            </Alert>
          )}
        </div>

        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Switch
            label="Vincular pelo e-mail"
            description="Liga a conta a um usuário ativo com o mesmo e-mail verificado"
            {...form.getInputProps('linkByEmail', { type: 'checkbox' })}
          />
          <Switch
            label="Criar usuários automaticamente"
            description="Cria o usuário, sem senha local, no primeiro login"
            {...form.getInputProps('autoProvision', { type: 'checkbox' })}
          />
          <Select
            label="Papel padrão"
            description="Papel dos usuários criados automaticamente"
            placeholder={roles.isPending ? 'Carregando papéis...' : 'Nenhum'}
            clearable
            searchable
            data={(roles.data ?? []).map((r) => ({ value: r.id, label: r.name }))}
            disabled={roles.isError}
            {...form.getInputProps('defaultRoleId')}
          />
          <TagsInput
            label="Domínios permitidos"
            description="Opcional. O e-mail precisa terminar em um destes domínios. Digite e tecle Enter."
            placeholder="empresa.com.br"
            splitChars={[',', ';', ' ']}
            clearable
            {...form.getInputProps('allowedDomains')}
          />
          <Switch
            label="Confiar no MFA do provedor"
            description="Dispensa o código local quando o provedor informa que fez a verificação em duas etapas (claim amr)"
            {...form.getInputProps('trustProviderMfa', { type: 'checkbox' })}
          />
          <Switch label="Provedor ativo" description="Mostra o botão na tela de login" {...form.getInputProps('enabled', { type: 'checkbox' })} />
        </SimpleGrid>

        {provider ? (
          <Stack gap={4}>
            <Text size="sm" fw={500}>
              URI de redirecionamento
            </Text>
            <CopyField value={provider.redirectUri} label="Copiar URI de redirecionamento" />
          </Stack>
        ) : (
          <Text size="sm" c="dimmed">
            A URI de redirecionamento para cadastrar no provedor aparece depois de salvar.
          </Text>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            {isEdit ? 'Salvar' : 'Criar provedor'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
