import { Badge, Box, Button, Center, Group, Loader, SimpleGrid, Stack, Text, Tooltip } from '@mantine/core';
import { IconAlertTriangle, IconExternalLink, IconRefresh } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { ApiError } from '../../../api/client';
import { queryKeys } from '../../../api/queryKeys';
import type { WebAppDetail } from '../../../api/types';
import { webAppsApi } from '../../../api/webapps';
import { MOBILE_PATHS } from '../../../app/paths';
import { NotFound } from '../../../components/NotFound';
import { LoadError } from '../../../components/TableStates';
import { notifySuccess } from '../../../lib/feedback';
import { formatDate, formatDateTime, formatRelative } from '../../../lib/format';
import { daysUntil, formatLatency, formatUptime, INTERVAL_OPTIONS, sshAddress, uptimeColor } from '../../webapps/webappFormat';
import { WebAppStatusBadge } from '../../webapps/WebAppStatusBadge';
import { InfoRows, MobileHeader, MobilePage, MobileSection } from '../MobilePage';
import { MOBILE_CARD } from '../mobileStyles';

export function MobileWebAppDetailPage() {
  const { id: rawId } = useParams();
  const id = Number(rawId);
  const valid = Number.isInteger(id) && id > 0;
  const app = useQuery({ queryKey: queryKeys.webApp(id), queryFn: () => webAppsApi.detail(id), enabled: valid, refetchInterval: 30_000 });
  const header = <MobileHeader title={app.data?.name ?? 'Aplicação'} back={{ to: MOBILE_PATHS.webApps, label: 'Aplicações' }} />;

  if (!valid || (app.error instanceof ApiError && app.error.status === 404)) {
    return (
      <MobilePage header={header}>
        <NotFound />
      </MobilePage>
    );
  }
  return (
    <MobilePage header={header}>
      {app.isError && <LoadError error={app.error} onRetry={() => void app.refetch()} />}
      {!app.data && !app.isError && (
        <Center py="xl">
          <Loader aria-label="Carregando aplicação" />
        </Center>
      )}
      {app.data && <AppView app={app.data} />}
    </MobilePage>
  );
}

function Stat({ label, value, color, hint }: { label: string; value: string; color?: string; hint?: string }) {
  return (
    <Box p={12} style={MOBILE_CARD}>
      <Text size="xs" fw={600} c="var(--ce-text-secondary)">
        {label}
      </Text>
      <Text fz={22} fw={700} lh="28px" c={color}>
        {value}
      </Text>
      {hint && (
        <Text size="xs" c="var(--ce-text-secondary)">
          {hint}
        </Text>
      )}
    </Box>
  );
}

function AppView({ app }: { app: WebAppDetail }) {
  const queryClient = useQueryClient();
  const checks = useQuery({ queryKey: queryKeys.webAppChecks(app.id, 24), queryFn: () => webAppsApi.checks(app.id, 24), refetchInterval: 60_000 });
  const check = useMutation({
    mutationFn: () => webAppsApi.checkNow(app.id),
    onSuccess: (result) => {
      if (result?.up) notifySuccess('A aplicação respondeu normalmente.', 'No ar');
      void queryClient.invalidateQueries({ queryKey: queryKeys.webApps });
    },
  });
  const ssl = daysUntil(app.sslExpiresAt);
  const interval = INTERVAL_OPTIONS.find((o) => o.value === String(app.intervalSeconds))?.label ?? `${app.intervalSeconds} s`;
  const down = app.status === 'down';
  const uptime = checks.data?.uptime;

  return (
    <>
      <Stack
        gap={10}
        p={16}
        style={{ ...MOBILE_CARD, ...(down ? { borderColor: 'var(--mantine-color-red-outline)' } : {}) }}
        component="section"
        aria-label="Situação"
      >
        <Group gap={8}>
          <WebAppStatusBadge status={app.status} size="md" />
          {app.environment && (
            <Badge variant="light" color={/produ/i.test(app.environment) ? 'blue' : 'gray'}>
              {app.environment}
            </Badge>
          )}
        </Group>
        {down && (
          <>
            <Group gap={8} wrap="nowrap" c="red">
              <IconAlertTriangle size={20} aria-hidden />
              <Text fz={18} fw={600} c="red">
                Fora do ar {app.statusChangedAt ? formatRelative(app.statusChangedAt) : ''}
              </Text>
            </Group>
            <Text>{app.lastError ?? 'Sem resposta.'}</Text>
          </>
        )}
        <Text size="sm" c="var(--ce-text-secondary)" style={{ overflowWrap: 'anywhere' }}>
          {[app.url ?? app.checkTarget, app.clientName, app.stack].filter(Boolean).join(' · ')}
        </Text>
        <SimpleGrid cols={app.url ? 2 : 1} spacing={8} mt={4}>
          <Button variant="light" leftSection={<IconRefresh size={18} />} loading={check.isPending} disabled={!app.monitorEnabled} onClick={() => check.mutate()}>
            Verificar agora
          </Button>
          {app.url && (
            <Button variant="default" component="a" href={app.url} target="_blank" rel="noreferrer" leftSection={<IconExternalLink size={18} />}>
              Abrir o site
            </Button>
          )}
        </SimpleGrid>
      </Stack>

      <SimpleGrid cols={2} spacing={8}>
        <Stat label="Disponib. 24 h" value={formatUptime(uptime?.h24 ?? null)} color={uptimeColor(uptime?.h24 ?? null)} />
        <Stat label="7 dias" value={formatUptime(uptime?.d7 ?? null)} color={uptimeColor(uptime?.d7 ?? null)} />
        <Stat label="Tempo de resposta" value={formatLatency(app.lastLatencyMs)} hint={app.lastStatusCode ? `Última resposta HTTP ${app.lastStatusCode}` : undefined} />
        <Stat
          label="Certificado TLS"
          value={ssl === null ? 'Sem TLS' : ssl < 0 ? 'Vencido' : `${ssl} dias`}
          color={ssl === null ? undefined : ssl < 0 ? 'red' : ssl <= app.sslWarnDays ? 'orange' : 'teal'}
          hint={app.sslExpiresAt ? `Vence em ${formatDate(app.sslExpiresAt)}` : undefined}
        />
      </SimpleGrid>

      <MobileSection title="Verificações nas últimas 24 h">
        {checks.isError && <LoadError error={checks.error} onRetry={() => void checks.refetch()} />}
        {checks.data &&
          (checks.data.points.length === 0 ? (
            <Text size="sm" c="var(--ce-text-secondary)">
              {app.monitorEnabled ? 'Nenhuma verificação no período ainda.' : 'O monitoramento está desligado nesta aplicação.'}
            </Text>
          ) : (
            <Box style={{ display: 'flex', gap: 2, height: 32 }} role="img" aria-label="Faixa de disponibilidade: verde no ar, vermelho com falha">
              {checks.data.points.map((p) => (
                <Tooltip key={p.time} label={`${formatDateTime(p.time)} · ${p.failures === 0 ? 'no ar' : `${p.failures} de ${p.checks} com falha`}`} events={{ hover: true, focus: false, touch: true }}>
                  <Box
                    style={{
                      flex: 1,
                      minWidth: 2,
                      borderRadius: 2,
                      background:
                        p.failures === 0 ? 'var(--mantine-color-teal-5)' : p.failures === p.checks ? 'var(--mantine-color-red-6)' : 'var(--mantine-color-orange-5)',
                    }}
                  />
                </Tooltip>
              ))}
            </Box>
          ))}
      </MobileSection>

      {checks.data && checks.data.outages.length > 0 && (
        <MobileSection title="Quedas recentes">
          <InfoRows
            rows={checks.data.outages.slice(0, 5).map((o) => ({
              label: formatDateTime(o.start),
              value: o.end ? (
                o.message
              ) : (
                <Text span size="sm" c="red" fw={600}>
                  {o.resolved ? 'Resolvido à mão' : 'Ainda fora do ar'}
                </Text>
              ),
            }))}
          />
        </MobileSection>
      )}

      <MobileSection title="Verificação">
        <InfoRows
          rows={[
            {
              label: 'Método',
              value: app.monitorEnabled ? `${app.checkType === 'tcp' ? 'Porta TCP' : `${app.method} ${app.expectedStatus}`} a cada ${interval.toLowerCase()}` : 'Desligado',
            },
            { label: 'Última verificação', value: formatRelative(app.lastCheckedAt) },
            { label: 'Servidor', value: app.server ? <Text span ff="monospace" size="sm">{sshAddress(app.server)}</Text> : 'Hospedagem externa' },
          ]}
        />
      </MobileSection>
    </>
  );
}
