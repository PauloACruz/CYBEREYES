import { useState } from 'react';
import { Alert, Anchor, Breadcrumbs, Button, Center, Code, Group, Loader, Paper, SimpleGrid, Stack, Tabs, Text } from '@mantine/core';
import {
  IconActivityHeartbeat,
  IconAlertTriangle,
  IconExternalLink,
  IconHistory,
  IconKey,
  IconPencil,
  IconRefresh,
  IconRocket,
  IconTerminal2,
  IconTrash,
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ApiError } from '../../api/client';
import { queryKeys } from '../../api/queryKeys';
import { PERMISSIONS, type WebAppDetail } from '../../api/types';
import { webAppsApi } from '../../api/webapps';
import { appServerPath, PATHS } from '../../app/paths';
import { hasPermission } from '../../auth/permissions';
import { useMe } from '../../auth/useMe';
import { NotFound } from '../../components/NotFound';
import { PageTitle } from '../../components/PageTitle';
import { LoadError } from '../../components/TableStates';
import { confirmAction, notifySuccess } from '../../lib/feedback';
import { formatDateTime, formatRelative } from '../../lib/format';
import { RelativeTime } from '../agents/agentDisplay';
import { CredentialsTab } from '../docs/credentials/CredentialsTab';
import { Field, Missing } from '../inventory/sheetDisplay';
import { CommandsPanel } from './CommandsPanel';
import { RunOutput } from './RunOutput';
import { RunsTable } from './RunsTable';
import { SshTerminal } from './SshTerminal';
import { UptimePanel } from './UptimePanel';
import { INTERVAL_OPTIONS, sshAddress } from './webappFormat';
import { WebAppFormModal } from './WebAppFormModal';
import { RunStatusBadge, WebAppStatusBadge } from './WebAppStatusBadge';

export function WebAppDetailPage() {
  const { id: rawId } = useParams();
  const id = Number(rawId);
  const valid = Number.isInteger(id) && id > 0;
  const app = useQuery({ queryKey: queryKeys.webApp(id), queryFn: () => webAppsApi.detail(id), enabled: valid, refetchInterval: 30_000 });

  if (!valid || (app.error instanceof ApiError && app.error.status === 404)) return <NotFound />;
  if (app.isError) return <LoadError error={app.error} onRetry={() => void app.refetch()} />;
  if (!app.data) {
    return (
      <Center py="xl">
        <Loader aria-label="Carregando aplicação" />
      </Center>
    );
  }
  return <WebAppView app={app.data} />;
}

const TABS = ['status', 'deploy', 'comandos', 'terminal', 'historico', 'credenciais'] as const;
type Tab = (typeof TABS)[number];

function WebAppView({ app }: { app: WebAppDetail }) {
  const { data: me } = useMe();
  const canManage = hasPermission(me, PERMISSIONS.appsManage);
  const canRun = hasPermission(me, PERMISSIONS.appsRun);
  const canDocs = hasPermission(me, PERMISSIONS.docsView);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [editing, setEditing] = useState(false);
  const [deployRun, setDeployRun] = useState<number | null>(null);
  const server = app.server;

  const check = useMutation({
    mutationFn: () => webAppsApi.checkNow(app.id),
    onSuccess: (result) => {
      if (result?.up) notifySuccess('A aplicação respondeu normalmente.', 'No ar');
      void queryClient.invalidateQueries({ queryKey: queryKeys.webApp(app.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.webApps });
    },
  });
  const deploy = useMutation({
    mutationFn: () => webAppsApi.deploy(app.id),
    onSuccess: (started) => {
      setDeployRun(started.id);
      selectTab('deploy');
      void queryClient.invalidateQueries({ queryKey: queryKeys.appRuns });
      void queryClient.invalidateQueries({ queryKey: queryKeys.webApp(app.id) });
    },
  });
  const remove = useMutation({
    mutationFn: () => webAppsApi.remove(app.id),
    onSuccess: async () => {
      notifySuccess(`Aplicação ${app.name} excluída.`);
      queryClient.removeQueries({ queryKey: queryKeys.webApp(app.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.webApps });
      await navigate(PATHS.webApps);
    },
  });

  const available: Tab[] = TABS.filter(
    (t) =>
      (server !== null || (t !== 'comandos' && t !== 'terminal' && t !== 'historico' && t !== 'deploy')) &&
      (t !== 'terminal' || canRun) &&
      (t !== 'credenciais' || canDocs),
  );
  const requested = searchParams.get('aba');
  const activeTab: Tab = available.find((t) => t === requested) ?? 'status';
  function selectTab(value: string | null) {
    if (!value) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === 'status') next.delete('aba');
        else next.set('aba', value);
        return next;
      },
      { replace: true },
    );
  }

  const confirmDeploy = () =>
    confirmAction({
      title: `Deploy de ${app.name}`,
      message: `Roda o script de deploy em ${server?.name ?? 'servidor'}${app.deployPath ? `, na pasta ${app.deployPath}` : ''}.`,
      confirmLabel: 'Fazer deploy',
      onConfirm: () => deploy.mutate(),
    });

  const currentDeploy = deployRun ?? (app.lastDeploy?.status === 'running' ? app.lastDeploy.id : null);
  const interval = INTERVAL_OPTIONS.find((o) => o.value === String(app.intervalSeconds))?.label ?? `${app.intervalSeconds} s`;

  return (
    <>
      <Breadcrumbs mb="xs">
        <Anchor component={Link} to={PATHS.webApps} size="sm">
          Aplicações
        </Anchor>
        {server && (
          <Anchor component={Link} to={appServerPath(server.id)} size="sm">
            {server.name}
          </Anchor>
        )}
        <Text size="sm">{app.name}</Text>
      </Breadcrumbs>
      <Group justify="space-between" align="flex-start" mb="lg" wrap="wrap" gap="sm">
        <PageTitle
          title={app.name}
          badges={<WebAppStatusBadge status={app.status} size="md" />}
          description={
            <>
              {app.url ?? app.checkTarget} · {app.clientName}
              {app.environment ? ` · ${app.environment}` : ''}
              {app.stack ? ` · ${app.stack}` : ''}
            </>
          }
        />
        <Group gap="sm">
          {app.url && (
            <Button variant="subtle" leftSection={<IconExternalLink size={16} />} component="a" href={app.url} target="_blank" rel="noreferrer">
              Abrir
            </Button>
          )}
          <Button variant="light" leftSection={<IconRefresh size={16} />} loading={check.isPending} onClick={() => check.mutate()} disabled={!app.monitorEnabled}>
            Verificar agora
          </Button>
          {canRun && app.hasDeploy && (
            <Button leftSection={<IconRocket size={16} />} loading={deploy.isPending} onClick={confirmDeploy}>
              Deploy
            </Button>
          )}
          {canManage && (
            <>
              <Button variant="default" leftSection={<IconPencil size={16} />} onClick={() => setEditing(true)}>
                Editar
              </Button>
              <Button
                color="red"
                variant="light"
                leftSection={<IconTrash size={16} />}
                loading={remove.isPending}
                onClick={() =>
                  confirmAction({
                    title: 'Excluir aplicação',
                    message: `Excluir ${app.name}, o histórico de verificações e os comandos salvos dela? As credenciais ligadas a ela continuam no cofre.`,
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

      {app.status === 'down' && (
        <Alert color="red" icon={<IconAlertTriangle size={18} />} mb="md" title={`Fora do ar ${app.statusChangedAt ? formatRelative(app.statusChangedAt) : ''}`}>
          {app.lastError ?? 'Sem resposta.'}
        </Alert>
      )}
      {app.status !== 'down' && app.lastError && app.consecutiveFailures > 0 && (
        <Alert color="orange" icon={<IconAlertTriangle size={18} />} mb="md" title="Falha na última verificação, confirmando">
          {app.lastError}
        </Alert>
      )}

      <Paper withBorder p="md" mb="lg">
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="lg">
          <Field label="Verificação">
            {app.monitorEnabled ? (
              <>
                {app.checkType === 'tcp' ? 'Porta TCP' : `${app.method} ${app.expectedStatus}`} a cada {interval.toLowerCase()}
                <Text size="xs" c="dimmed" ff="monospace" style={{ wordBreak: 'break-all' }}>
                  {app.checkTarget}
                </Text>
              </>
            ) : (
              <Missing text="Monitoramento desligado" />
            )}
          </Field>
          <Field label="Última verificação">
            <RelativeTime value={app.lastCheckedAt} />
          </Field>
          <Field label="Alerta">
            Depois de {app.failuresBeforeAlert} falha(s) seguida(s) · {app.alertSeverity === 'error' ? 'erro' : app.alertSeverity === 'warning' ? 'aviso' : 'informativo'}
          </Field>
          <Field label="Servidor">
            {server ? (
              <>
                <Anchor component={Link} to={appServerPath(server.id)} size="sm">
                  {server.name}
                </Anchor>
                <Text size="xs" c="dimmed" ff="monospace">
                  {sshAddress(server)}
                </Text>
              </>
            ) : (
              <Missing text="Hospedagem externa (sem SSH)" />
            )}
          </Field>
        </SimpleGrid>
        {app.notes && (
          <Text size="sm" mt="md" style={{ whiteSpace: 'pre-wrap' }}>
            {app.notes}
          </Text>
        )}
      </Paper>

      <Tabs value={activeTab} onChange={selectTab} keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="status" leftSection={<IconActivityHeartbeat size={16} />}>
            Disponibilidade
          </Tabs.Tab>
          {available.includes('deploy') && (
            <Tabs.Tab value="deploy" leftSection={<IconRocket size={16} />}>
              Deploy
            </Tabs.Tab>
          )}
          {available.includes('comandos') && (
            <Tabs.Tab value="comandos" leftSection={<IconTerminal2 size={16} />}>
              Comandos
            </Tabs.Tab>
          )}
          {available.includes('terminal') && (
            <Tabs.Tab value="terminal" leftSection={<IconTerminal2 size={16} />}>
              Terminal
            </Tabs.Tab>
          )}
          {available.includes('historico') && (
            <Tabs.Tab value="historico" leftSection={<IconHistory size={16} />}>
              Histórico
            </Tabs.Tab>
          )}
          {available.includes('credenciais') && (
            <Tabs.Tab value="credenciais" leftSection={<IconKey size={16} />}>
              Credenciais
            </Tabs.Tab>
          )}
        </Tabs.List>

        <Tabs.Panel value="status">
          <UptimePanel app={app} />
        </Tabs.Panel>

        {server && (
          <Tabs.Panel value="deploy">
            <Stack>
              <Paper withBorder p="md">
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="lg" mb={app.deployScript ? 'md' : 0}>
                  <Field label="Pasta">{app.deployPath ? <Text ff="monospace" size="sm">{app.deployPath}</Text> : <Missing text="pasta do usuário SSH" />}</Field>
                  <Field label="Repositório">{app.repoUrl ? <Text ff="monospace" size="sm" style={{ wordBreak: 'break-all' }}>{app.repoUrl}</Text> : <Missing />}</Field>
                  <Field label="Branch">{app.branch ?? <Missing />}</Field>
                  <Field label="Último deploy">
                    {app.lastDeploy ? (
                      <Group gap="xs">
                        <RunStatusBadge status={app.lastDeploy.status} />
                        <Text size="xs" c="dimmed">
                          {formatDateTime(app.lastDeploy.startedAt)} · {app.lastDeploy.startedBy}
                        </Text>
                      </Group>
                    ) : (
                      <Missing text="Nunca" />
                    )}
                  </Field>
                </SimpleGrid>
                {app.deployScript ? (
                  <Code block style={{ whiteSpace: 'pre-wrap' }}>
                    {app.deployScript}
                  </Code>
                ) : (
                  <Text size="sm" c="dimmed" mt="md">
                    Nenhum script de deploy configurado.{canManage ? ' Configure em Editar > Deploy.' : ''}
                  </Text>
                )}
              </Paper>
              {currentDeploy !== null && <RunOutput runId={currentDeploy} canCancel={canRun} />}
              <Text fw={600} size="sm">
                Deploys anteriores
              </Text>
              <RunsTable webAppId={app.id} kind="deploy" canCancel={canRun} />
            </Stack>
          </Tabs.Panel>
        )}

        {server && (
          <Tabs.Panel value="comandos">
            <CommandsPanel serverId={server.id} webAppId={app.id} directory={app.deployPath} canRun={canRun} canManage={canManage} />
          </Tabs.Panel>
        )}

        {server && canRun && (
          <Tabs.Panel value="terminal">
            <SshTerminal serverId={server.id} webAppId={app.id} directory={app.deployPath} label={`Terminal SSH de ${app.name}`} />
          </Tabs.Panel>
        )}

        {server && (
          <Tabs.Panel value="historico">
            <RunsTable webAppId={app.id} canCancel={canRun} />
          </Tabs.Panel>
        )}

        {canDocs && (
          <Tabs.Panel value="credenciais">
            <Text size="sm" c="dimmed" mb="sm">
              Login do painel, banco de dados, tokens de API e o .env da aplicação. Ficam cifrados no cofre e aparecem também em Documentação &gt;
              Credenciais.
            </Text>
            <CredentialsTab
              clientId={app.clientId}
              webAppId={app.id}
              canManage={hasPermission(me, PERMISSIONS.credentialsManage)}
              canReveal={hasPermission(me, PERMISSIONS.credentialsReveal)}
            />
          </Tabs.Panel>
        )}
      </Tabs>

      {canManage && editing && <WebAppFormModal opened onClose={() => setEditing(false)} app={app} />}
    </>
  );
}
