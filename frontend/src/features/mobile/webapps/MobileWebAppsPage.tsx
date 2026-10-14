import type { ReactNode } from 'react';
import { Badge, Box, Group, SimpleGrid, Skeleton, Stack, Text } from '@mantine/core';
import { IconAlertTriangle, IconChevronRight, IconServer2, IconWorldWww } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { queryKeys } from '../../../api/queryKeys';
import type { WebAppDto } from '../../../api/types';
import { webAppsApi } from '../../../api/webapps';
import { mobileWebAppPath } from '../../../app/paths';
import { LoadError } from '../../../components/TableStates';
import { formatRelative } from '../../../lib/format';
import { daysUntil, formatLatency, formatUptime, sshAddress, summarize, uptimeColor } from '../../webapps/webappFormat';
import { WebAppStatusBadge } from '../../webapps/WebAppStatusBadge';
import { MobileHeader, MobilePage } from '../MobilePage';
import { MOBILE_CARD } from '../mobileStyles';

function Tile({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <Box p={12} style={MOBILE_CARD}>
      <Text size="xs" fw={600} c="var(--ce-text-secondary)">
        {label}
      </Text>
      <Text fz={24} fw={700} lh="30px" c={value > 0 ? color : undefined}>
        {value}
      </Text>
    </Box>
  );
}

function AppRow({ app, first }: { app: WebAppDto; first: boolean }) {
  const ssl = daysUntil(app.sslExpiresAt);
  return (
    <Box
      component={Link}
      to={mobileWebAppPath(app.id)}
      aria-label={`${app.name}: ${app.status === 'down' ? 'fora do ar' : app.status === 'up' ? 'no ar' : app.status}`}
      px={16}
      py={12}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        textDecoration: 'none',
        color: 'inherit',
        borderTop: first ? undefined : '1px solid var(--ce-border-subtle)',
      }}
    >
      <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
        <Group gap={6} wrap="nowrap">
          <Text fw={600} size="md" truncate>
            {app.name}
          </Text>
          {app.environment && (
            <Badge size="xs" variant="light" color={/produ/i.test(app.environment) ? 'blue' : 'gray'}>
              {app.environment}
            </Badge>
          )}
        </Group>
        <Text size="sm" c={app.status === 'down' ? 'red' : 'var(--ce-text-secondary)'} truncate>
          {app.status === 'down' && app.lastError ? app.lastError : (app.url ?? app.checkTarget)}
        </Text>
        <Group gap={12}>
          <Text size="sm" c="var(--ce-text-secondary)">
            24 h{' '}
            <Text span fw={600} c={uptimeColor(app.uptime24h)}>
              {formatUptime(app.uptime24h)}
            </Text>
          </Text>
          <Text size="sm" c="var(--ce-text-secondary)">
            {formatLatency(app.lastLatencyMs)}
          </Text>
          {ssl !== null && ssl <= 14 && (
            <Text size="sm" fw={600} c={ssl < 0 ? 'red' : 'orange'}>
              {ssl < 0 ? 'Certificado vencido' : `Certificado: ${ssl} dias`}
            </Text>
          )}
        </Group>
      </Stack>
      <WebAppStatusBadge status={app.status} />
    </Box>
  );
}

function Group_({ icon, title, subtitle, extra, apps }: { icon: ReactNode; title: string; subtitle: ReactNode; extra?: ReactNode; apps: WebAppDto[] }) {
  return (
    <Box component="section" aria-label={title} style={{ ...MOBILE_CARD, overflow: 'hidden' }}>
      <Group gap={8} wrap="nowrap" px={16} py={12} style={{ borderBottom: '1px solid var(--ce-border-subtle)' }}>
        <Box c="var(--ce-text-secondary)" display="flex">
          {icon}
        </Box>
        <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
          <Text fw={600} truncate>
            {title}
          </Text>
          <Text size="xs" c="var(--ce-text-secondary)" truncate>
            {subtitle}
          </Text>
        </Stack>
        {extra}
      </Group>
      {apps.length === 0 ? (
        <Text size="sm" c="var(--ce-text-secondary)" px={16} py={12}>
          Nenhuma aplicação neste servidor.
        </Text>
      ) : (
        apps.map((app, index) => <AppRow key={app.id} app={app} first={index === 0} />)
      )}
    </Box>
  );
}

/** Aplicacoes por servidor, com as que estao fora do ar em destaque no topo. */
export function MobileWebAppsPage() {
  const overview = useQuery({ queryKey: queryKeys.webAppOverview({}), queryFn: () => webAppsApi.overview({}), refetchInterval: 30_000 });
  const servers = overview.data?.servers ?? [];
  const apps = overview.data?.apps ?? [];
  const summary = summarize(apps);
  const down = apps.filter((a) => a.status === 'down');
  const external = apps.filter((a) => a.serverId === null);

  return (
    <MobilePage header={<MobileHeader title="Aplicações" />}>
      {overview.isError && <LoadError error={overview.error} onRetry={() => void overview.refetch()} />}
      {overview.isPending && <Skeleton h={240} radius="md" />}
      {overview.isSuccess && apps.length === 0 && servers.length === 0 && (
        <Text c="var(--ce-text-secondary)" ta="center" py="xl">
          Nenhuma aplicação cadastrada. O cadastro é feito no console.
        </Text>
      )}
      {overview.isSuccess && (apps.length > 0 || servers.length > 0) && (
        <>
          <SimpleGrid cols={3} spacing={8}>
            <Tile label="No ar" value={summary.up} color="teal" />
            <Tile label="Fora do ar" value={summary.down} color="red" />
            <Tile label="Cert. vencendo" value={summary.sslSoon} color="orange" />
          </SimpleGrid>
          {down.map((app) => (
            <Box
              key={app.id}
              component={Link}
              to={mobileWebAppPath(app.id)}
              role="alert"
              p="14px 16px"
              style={{
                display: 'flex',
                gap: 12,
                borderRadius: 8,
                background: 'var(--mantine-color-red-light)',
                border: '1px solid var(--mantine-color-red-outline)',
                textDecoration: 'none',
                color: 'inherit',
              }}
            >
              <Box c="red" display="flex">
                <IconAlertTriangle size={22} aria-hidden />
              </Box>
              <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                <Text fw={700} c="red">
                  {app.name} fora do ar {app.statusChangedAt ? formatRelative(app.statusChangedAt) : ''}
                </Text>
                <Text size="sm">{app.lastError ?? 'Sem resposta.'}</Text>
                <Text size="sm" c="var(--ce-text-secondary)">
                  {[servers.find((s) => s.id === app.serverId)?.name, app.clientName].filter(Boolean).join(' · ')}
                </Text>
              </Stack>
              <Box c="var(--ce-text-secondary)" style={{ display: 'flex', alignSelf: 'center' }}>
                <IconChevronRight size={20} aria-hidden />
              </Box>
            </Box>
          ))}
          {servers.map((server) => {
            const rows = apps.filter((a) => a.serverId === server.id);
            const serverDown = rows.filter((a) => a.status === 'down').length;
            return (
              <Group_
                key={server.id}
                icon={<IconServer2 size={18} />}
                title={server.name}
                subtitle={
                  <Text span ff="monospace" size="xs">
                    {sshAddress(server)}
                  </Text>
                }
                extra={
                  serverDown > 0 && (
                    <Badge color="red" variant="filled">
                      {serverDown} fora do ar
                    </Badge>
                  )
                }
                apps={rows}
              />
            );
          })}
          {external.length > 0 && <Group_ icon={<IconWorldWww size={18} />} title="Sem servidor SSH" subtitle="Hospedagem externa: só monitoramento" apps={external} />}
        </>
      )}
    </MobilePage>
  );
}
