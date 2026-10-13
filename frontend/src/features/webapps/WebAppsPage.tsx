import { useState } from 'react';
import {
  ActionIcon,
  Anchor,
  Badge,
  Button,
  CopyButton,
  Group,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import {
  IconCheck,
  IconCopy,
  IconPlus,
  IconSearch,
  IconServer2,
  IconTerminal2,
  IconWorldWww,
} from '@tabler/icons-react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { queryKeys } from '../../api/queryKeys';
import { PERMISSIONS, type AppServerDto, type ListWebAppsParams, type WebAppDto } from '../../api/types';
import { webAppsApi } from '../../api/webapps';
import { appServerPath } from '../../app/paths';
import { hasPermission } from '../../auth/permissions';
import { useMe } from '../../auth/useMe';
import { PageHeader } from '../../components/PageHeader';
import { LoadError } from '../../components/TableStates';
import { useClients } from '../clients/useClients';
import { ServerFormModal } from './ServerFormModal';
import { sshAddress, summarize } from './webappFormat';
import { WebAppFormModal } from './WebAppFormModal';
import { WebAppsTable } from './WebAppsTable';

type StatusFilter = 'all' | 'down' | 'up';

function toId(value: string | null): number | undefined {
  if (!value) return undefined;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

function SummaryTile({ label, value, color, onClick, active }: { label: string; value: number; color?: string; onClick?: () => void; active?: boolean }) {
  return (
    <Paper
      withBorder
      p="sm"
      component={onClick ? 'button' : 'div'}
      onClick={onClick}
      style={{ textAlign: 'left', cursor: onClick ? 'pointer' : undefined, borderColor: active ? `var(--mantine-color-${color ?? 'gray'}-5)` : undefined }}
    >
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text size="xl" fw={700} c={value > 0 ? color : undefined}>
        {value}
      </Text>
    </Paper>
  );
}

export function WebAppsPage() {
  const { data: me } = useMe();
  const canManage = hasPermission(me, PERMISSIONS.appsManage);
  const canRun = hasPermission(me, PERMISSIONS.appsRun);
  const clients = useClients(hasPermission(me, PERMISSIONS.clientsView));
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('busca') ?? '');
  const [debounced] = useDebouncedValue(search.trim(), 300);
  const [serverModal, setServerModal] = useState<{ server: AppServerDto | null } | null>(null);
  const [appModal, setAppModal] = useState<{ serverId?: number; clientId?: number } | null>(null);

  const statusParam = searchParams.get('status');
  const status: StatusFilter = statusParam === 'down' || statusParam === 'up' ? statusParam : 'all';
  const params: ListWebAppsParams = { clientId: toId(searchParams.get('cliente')), search: debounced || undefined };
  const updateParam = (key: string, value: string | null) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  const overview = useQuery({
    queryKey: queryKeys.webAppOverview(params),
    queryFn: () => webAppsApi.overview(params),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });

  const servers = overview.data?.servers ?? [];
  const allApps = overview.data?.apps ?? [];
  const apps = allApps.filter((a) => status === 'all' || a.status === status);
  const summary = summarize(allApps);
  const byServer = new Map<number, WebAppDto[]>();
  const external: WebAppDto[] = [];
  for (const app of apps) {
    if (app.serverId === null) external.push(app);
    else byServer.set(app.serverId, [...(byServer.get(app.serverId) ?? []), app]);
  }
  const visibleServers = status === 'all' ? servers : servers.filter((s) => (byServer.get(s.id)?.length ?? 0) > 0);
  const empty = overview.isSuccess && servers.length === 0 && allApps.length === 0;

  return (
    <>
      <PageHeader
        title="Aplicações"
        description="Sites e aplicações web monitorados, agrupados pelo servidor onde rodam. O Cybereyes verifica cada um no intervalo escolhido e abre um alerta quando algum sai do ar; pelos servidores você abre terminal SSH, roda comandos salvos e faz deploy."
        actions={
          canManage && (
            <>
              <Button variant="light" leftSection={<IconServer2 size={16} />} onClick={() => setServerModal({ server: null })}>
                Novo servidor
              </Button>
              <Button leftSection={<IconPlus size={16} />} onClick={() => setAppModal({ clientId: params.clientId })}>
                Nova aplicação
              </Button>
            </>
          )
        }
      />

      <SimpleGrid cols={{ base: 2, sm: 3, lg: 5 }} mb="md">
        <SummaryTile label="Aplicações" value={summary.total} onClick={() => updateParam('status', null)} active={status === 'all'} />
        <SummaryTile label="No ar" value={summary.up} color="teal" onClick={() => updateParam('status', 'up')} active={status === 'up'} />
        <SummaryTile label="Fora do ar" value={summary.down} color="red" onClick={() => updateParam('status', 'down')} active={status === 'down'} />
        <SummaryTile label="Verificando ou pausadas" value={summary.pending + summary.paused} />
        <SummaryTile label="Certificado vencendo" value={summary.sslSoon} color="orange" />
      </SimpleGrid>

      <Group mb="md" gap="sm" wrap="wrap">
        <TextInput
          placeholder="Aplicação, URL, servidor ou IP"
          aria-label="Buscar aplicações"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => {
            setSearch(e.currentTarget.value);
            updateParam('busca', e.currentTarget.value.trim() || null);
          }}
          w={280}
        />
        {clients.data && (
          <Select
            aria-label="Cliente"
            placeholder="Todos os clientes"
            clearable
            searchable
            data={clients.data.map((c) => ({ value: String(c.id), label: c.name }))}
            value={params.clientId ? String(params.clientId) : null}
            onChange={(v) => updateParam('cliente', v)}
            w={240}
          />
        )}
        <SegmentedControl
          aria-label="Status"
          data={[
            { value: 'all', label: 'Todas' },
            { value: 'down', label: 'Fora do ar' },
            { value: 'up', label: 'No ar' },
          ]}
          value={status}
          onChange={(v) => updateParam('status', v === 'all' ? null : v)}
        />
      </Group>

      {overview.isError && <LoadError error={overview.error} onRetry={() => void overview.refetch()} />}

      {empty && (
        <Paper withBorder p="xl">
          <Stack align="center" gap="xs">
            <IconWorldWww size={36} stroke={1.4} />
            <Text fw={600}>Nenhuma aplicação cadastrada</Text>
            <Text size="sm" c="dimmed" ta="center" maw={560}>
              Cadastre o servidor (IP, usuário e chave ou senha SSH) e depois as aplicações que rodam nele. Sites em hospedagem sem SSH também podem ser
              cadastrados, só para monitoramento.
            </Text>
            {canManage && (
              <Group mt="sm">
                <Button variant="light" leftSection={<IconServer2 size={16} />} onClick={() => setServerModal({ server: null })}>
                  Cadastrar servidor
                </Button>
                <Button leftSection={<IconPlus size={16} />} onClick={() => setAppModal({})}>
                  Cadastrar aplicação
                </Button>
              </Group>
            )}
          </Stack>
        </Paper>
      )}

      <Stack gap="md" style={{ opacity: overview.isPlaceholderData ? 0.6 : 1 }}>
        {visibleServers.map((server) => {
          const rows = byServer.get(server.id) ?? [];
          const down = rows.filter((a) => a.status === 'down').length;
          return (
            <Paper key={server.id} withBorder>
              <Group justify="space-between" p="sm" wrap="wrap" gap="sm" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
                <Group gap="sm" wrap="wrap">
                  <IconServer2 size={20} aria-hidden />
                  <Anchor component={Link} to={appServerPath(server.id)} fw={700}>
                    {server.name}
                  </Anchor>
                  <Group gap={2} wrap="nowrap">
                    <Text size="sm" ff="monospace" c="dimmed">
                      {sshAddress(server)}
                    </Text>
                    <CopyButton value={`ssh ${server.port === 22 ? '' : `-p ${server.port} `}${server.username}@${server.host}`}>
                      {({ copied, copy }) => (
                        <Tooltip label={copied ? 'Copiado' : 'Copiar comando ssh'}>
                          <ActionIcon size="sm" variant="subtle" color={copied ? 'teal' : 'gray'} onClick={copy} aria-label="Copiar comando ssh">
                            {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                          </ActionIcon>
                        </Tooltip>
                      )}
                    </CopyButton>
                  </Group>
                  {server.provider && (
                    <Badge size="sm" variant="light" color="gray">
                      {server.provider}
                    </Badge>
                  )}
                  <Text size="sm" c="dimmed">
                    {server.clientName}
                  </Text>
                  {down > 0 && (
                    <Badge size="sm" color="red">
                      {down} fora do ar
                    </Badge>
                  )}
                </Group>
                <Group gap="xs">
                  {canRun && (
                    <Button size="xs" variant="light" leftSection={<IconTerminal2 size={14} />} component={Link} to={`${appServerPath(server.id)}?aba=terminal`}>
                      Terminal
                    </Button>
                  )}
                  <Button size="xs" variant="subtle" component={Link} to={`${appServerPath(server.id)}?aba=comandos`}>
                    Comandos
                  </Button>
                  {canManage && (
                    <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />} onClick={() => setAppModal({ serverId: server.id, clientId: server.clientId })}>
                      Aplicação
                    </Button>
                  )}
                </Group>
              </Group>
              <WebAppsTable rows={rows} canRun={canRun} emptyText="Nenhuma aplicação neste servidor." />
            </Paper>
          );
        })}

        {external.length > 0 && (
          <Paper withBorder>
            <Group gap="sm" p="sm" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
              <IconWorldWww size={20} aria-hidden />
              <Text fw={700}>Sem servidor SSH</Text>
              <Text size="sm" c="dimmed">
                Hospedagem externa: só monitoramento
              </Text>
            </Group>
            <WebAppsTable rows={external} canRun={canRun} />
          </Paper>
        )}

        {overview.isSuccess && !empty && visibleServers.length === 0 && external.length === 0 && (
          <Text size="sm" c="dimmed">
            Nenhuma aplicação encontrada com estes filtros.
          </Text>
        )}
      </Stack>

      {canManage && serverModal && (
        <ServerFormModal opened onClose={() => setServerModal(null)} server={serverModal.server} defaultClientId={params.clientId} />
      )}
      {canManage && appModal && (
        <WebAppFormModal opened onClose={() => setAppModal(null)} app={null} defaultClientId={appModal.clientId} defaultServerId={appModal.serverId} />
      )}
    </>
  );
}
