import { useState } from 'react';
import { Alert, Anchor, Breadcrumbs, Button, Center, Code, Group, Loader, Paper, SimpleGrid, Stack, Tabs, Text } from '@mantine/core';
import {
  IconAlertTriangle,
  IconHistory,
  IconKey,
  IconLock,
  IconPencil,
  IconPlugConnected,
  IconPlugConnectedX,
  IconPlus,
  IconTerminal2,
  IconTrash,
  IconWorldWww,
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ApiError } from '../../api/client';
import { queryKeys } from '../../api/queryKeys';
import { PERMISSIONS, type AppServerDto, type AppServerTestResult } from '../../api/types';
import { appServersApi, webAppsApi } from '../../api/webapps';
import { PATHS } from '../../app/paths';
import { hasPermission } from '../../auth/permissions';
import { useMe } from '../../auth/useMe';
import { CopyField } from '../../components/CopyField';
import { NotFound } from '../../components/NotFound';
import { PageTitle } from '../../components/PageTitle';
import { LoadError } from '../../components/TableStates';
import { confirmAction, notifySuccess } from '../../lib/feedback';
import { formatDateTime } from '../../lib/format';
import { CredentialsTab } from '../docs/credentials/CredentialsTab';
import { Field, Missing } from '../inventory/sheetDisplay';
import { CommandsPanel } from './CommandsPanel';
import { RunsTable } from './RunsTable';
import { ServerFormModal } from './ServerFormModal';
import { ServerSecretReveal } from './ServerSecretReveal';
import { SshTerminal } from './SshTerminal';
import { sshAddress } from './webappFormat';
import { WebAppFormModal } from './WebAppFormModal';
import { WebAppsTable } from './WebAppsTable';

export function ServerDetailPage() {
  const { id: rawId } = useParams();
  const id = Number(rawId);
  const valid = Number.isInteger(id) && id > 0;
  const server = useQuery({ queryKey: queryKeys.appServer(id), queryFn: () => appServersApi.get(id), enabled: valid });

  if (!valid || (server.error instanceof ApiError && server.error.status === 404)) return <NotFound />;
  if (server.isError) return <LoadError error={server.error} onRetry={() => void server.refetch()} />;
  if (!server.data) {
    return (
      <Center py="xl">
        <Loader aria-label="Carregando servidor" />
      </Center>
    );
  }
  return <ServerView server={server.data} />;
}

const TABS = ['aplicacoes', 'terminal', 'comandos', 'historico', 'credenciais'] as const;
type Tab = (typeof TABS)[number];

function ServerView({ server }: { server: AppServerDto }) {
  const { data: me } = useMe();
  const canManage = hasPermission(me, PERMISSIONS.appsManage);
  const canRun = hasPermission(me, PERMISSIONS.appsRun);
  const canReveal = hasPermission(me, PERMISSIONS.credentialsReveal);
  const canDocs = hasPermission(me, PERMISSIONS.docsView);
  const canManageCredentials = hasPermission(me, PERMISSIONS.credentialsManage);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [editing, setEditing] = useState(false);
  const [addingApp, setAddingApp] = useState(false);
  const [test, setTest] = useState<AppServerTestResult | null>(null);

  const overview = useQuery({ queryKey: queryKeys.webAppOverview({ clientId: server.clientId }), queryFn: () => webAppsApi.overview({ clientId: server.clientId }) });
  const apps = (overview.data?.apps ?? []).filter((a) => a.serverId === server.id);

  const runTest = useMutation({
    mutationFn: () => appServersApi.test(server.id),
    onSuccess: (result) => {
      setTest(result);
      void queryClient.invalidateQueries({ queryKey: queryKeys.appServer(server.id) });
    },
  });
  const resetKey = useMutation({
    mutationFn: () => appServersApi.resetHostKey(server.id),
    onSuccess: () => {
      notifySuccess('Chave liberada: a próxima conexão fixa a chave nova.');
      setTest(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.appServer(server.id) });
    },
  });
  const remove = useMutation({
    mutationFn: () => appServersApi.remove(server.id),
    onSuccess: async () => {
      notifySuccess(`Servidor ${server.name} excluído.`);
      queryClient.removeQueries({ queryKey: queryKeys.appServer(server.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.webApps });
      await navigate(PATHS.webApps);
    },
  });

  const available: Tab[] = TABS.filter((t) => (t !== 'terminal' || canRun) && (t !== 'credenciais' || canDocs));
  const requested = searchParams.get('aba');
  const activeTab: Tab = available.find((t) => t === requested) ?? 'aplicacoes';
  const selectTab = (value: string | null) => {
    if (!value) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === 'aplicacoes') next.delete('aba');
        else next.set('aba', value);
        return next;
      },
      { replace: true },
    );
  };
  const hasSecret = server.authMethod === 'key' ? server.hasPrivateKey : server.hasPassword;
  const sshCommand = `ssh ${server.port === 22 ? '' : `-p ${server.port} `}${server.username}@${server.host}`;

  return (
    <>
      <Breadcrumbs mb="xs">
        <Anchor component={Link} to={PATHS.webApps} size="sm">
          Aplicações
        </Anchor>
        <Text size="sm">{server.name}</Text>
      </Breadcrumbs>
      <Group justify="space-between" align="flex-start" mb="lg" wrap="wrap" gap="sm">
        <PageTitle
          title={server.name}
          description={
            <>
              {sshAddress(server)} · {server.clientName}
              {server.provider ? ` · ${server.provider}` : ''}
            </>
          }
        />
        <Group gap="sm">
          {canRun && (
            <Button variant="light" leftSection={<IconPlugConnected size={16} />} loading={runTest.isPending} onClick={() => runTest.mutate()}>
              Testar conexão
            </Button>
          )}
          {canManage && (
            <>
              <Button leftSection={<IconPencil size={16} />} onClick={() => setEditing(true)}>
                Editar
              </Button>
              <Button
                color="red"
                variant="light"
                leftSection={<IconTrash size={16} />}
                loading={remove.isPending}
                onClick={() =>
                  confirmAction({
                    title: 'Excluir servidor',
                    message: `Excluir ${server.name}, os comandos salvos e o histórico de execuções? As aplicações continuam cadastradas, sem servidor.`,
                    confirmLabel: 'Excluir',
                    danger: true,
                    onConfirm: () => remove.mutate(),
                  })
                }
              >
                Excluir
              </Button>
            </>
          )}
        </Group>
      </Group>

      {!hasSecret && (
        <Alert color="yellow" icon={<IconKey size={18} />} mb="md" title="Sem credencial SSH">
          Cadastre a chave privada ou a senha em Editar para usar terminal, comandos e deploy.
        </Alert>
      )}
      {test?.ok && (
        <Alert color="teal" icon={<IconPlugConnected size={18} />} mb="md" title="Conexão bem-sucedida" withCloseButton onClose={() => setTest(null)}>
          {test.system && (
            <Code block style={{ whiteSpace: 'pre-wrap' }}>
              {test.system}
            </Code>
          )}
        </Alert>
      )}
      {test && !test.ok && (
        <Alert color="red" icon={<IconPlugConnectedX size={18} />} mb="md" title="Não conectou" withCloseButton onClose={() => setTest(null)}>
          <Stack gap="xs">
            <Text size="sm">{test.error}</Text>
            {test.code === 'HOST_KEY_MISMATCH' && canManage && (
              <Group>
                <Button
                  size="xs"
                  color="red"
                  variant="light"
                  loading={resetKey.isPending}
                  onClick={() =>
                    confirmAction({
                      title: 'Aceitar a nova chave do servidor?',
                      message:
                        'Faça isso só se o servidor foi reinstalado ou trocou a chave SSH. Se não foi, alguém pode estar interceptando a conexão.',
                      confirmLabel: 'Aceitar nova chave',
                      danger: true,
                      onConfirm: () => resetKey.mutate(),
                    })
                  }
                >
                  Aceitar nova chave
                </Button>
              </Group>
            )}
          </Stack>
        </Alert>
      )}

      <Paper withBorder p="md" mb="lg">
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="lg">
          <Field label="Acesso">
            <CopyField value={sshCommand} label="Copiar comando ssh" />
          </Field>
          <Field label="Autenticação">
            <Group gap="xs">
              <Text size="sm">{server.authMethod === 'key' ? `Chave privada${server.hasPassphrase ? ' com senha' : ''}` : 'Senha'}</Text>
              {hasSecret && canReveal && <ServerSecretReveal serverId={server.id} name={server.name} />}
              {!hasSecret && <Missing text="não cadastrada" />}
            </Group>
          </Field>
          <Field label="Chave do servidor">
            {server.hostKeyFingerprint ? (
              <Group gap={4} wrap="nowrap">
                <IconLock size={14} aria-hidden />
                <Text size="xs" ff="monospace" style={{ wordBreak: 'break-all' }}>
                  {server.hostKeyAlgorithm ? `${server.hostKeyAlgorithm} ` : ''}SHA256:{server.hostKeyFingerprint}
                </Text>
              </Group>
            ) : (
              <Missing text="fixada no primeiro acesso" />
            )}
          </Field>
          <Field label="Última conexão">{server.lastConnectedAt ? formatDateTime(server.lastConnectedAt) : <Missing text="Nunca" />}</Field>
        </SimpleGrid>
        {server.notes && (
          <Text size="sm" mt="md" style={{ whiteSpace: 'pre-wrap' }}>
            {server.notes}
          </Text>
        )}
      </Paper>

      <Tabs value={activeTab} onChange={selectTab} keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="aplicacoes" leftSection={<IconWorldWww size={16} />}>
            Aplicações ({apps.length})
          </Tabs.Tab>
          {canRun && (
            <Tabs.Tab value="terminal" leftSection={<IconTerminal2 size={16} />}>
              Terminal
            </Tabs.Tab>
          )}
          <Tabs.Tab value="comandos" leftSection={<IconTerminal2 size={16} />}>
            Comandos
          </Tabs.Tab>
          <Tabs.Tab value="historico" leftSection={<IconHistory size={16} />}>
            Histórico
          </Tabs.Tab>
          {canDocs && (
            <Tabs.Tab value="credenciais" leftSection={<IconKey size={16} />}>
              Credenciais
            </Tabs.Tab>
          )}
        </Tabs.List>
        <Tabs.Panel value="aplicacoes">
          <Stack>
            {canManage && (
              <Group justify="flex-end">
                <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setAddingApp(true)}>
                  Nova aplicação neste servidor
                </Button>
              </Group>
            )}
            <Paper withBorder>
              <WebAppsTable rows={apps} canRun={canRun} emptyText="Nenhuma aplicação cadastrada neste servidor." />
            </Paper>
          </Stack>
        </Tabs.Panel>
        {canRun && (
          <Tabs.Panel value="terminal">
            {hasSecret ? (
              <SshTerminal serverId={server.id} label={`Terminal SSH de ${server.name}`} />
            ) : (
              <Alert color="yellow" icon={<IconAlertTriangle size={18} />}>
                Cadastre a credencial SSH para abrir o terminal.
              </Alert>
            )}
          </Tabs.Panel>
        )}
        <Tabs.Panel value="comandos">
          <CommandsPanel serverId={server.id} canRun={canRun && hasSecret} canManage={canManage} />
        </Tabs.Panel>
        <Tabs.Panel value="historico">
          <RunsTable serverId={server.id} canCancel={canRun} />
        </Tabs.Panel>
        {canDocs && (
          <Tabs.Panel value="credenciais">
            <Text size="sm" c="dimmed" mb="sm">
              Painéis, bancos, tokens e arquivos .env deste servidor. Ficam cifrados no cofre e aparecem também em Documentação &gt; Credenciais.
            </Text>
            <CredentialsTab clientId={server.clientId} appServerId={server.id} canManage={canManageCredentials} canReveal={canReveal} />
          </Tabs.Panel>
        )}
      </Tabs>

      {canManage && editing && <ServerFormModal opened onClose={() => setEditing(false)} server={server} />}
      {canManage && addingApp && (
        <WebAppFormModal opened onClose={() => setAddingApp(false)} app={null} defaultClientId={server.clientId} defaultServerId={server.id} />
      )}
    </>
  );
}
