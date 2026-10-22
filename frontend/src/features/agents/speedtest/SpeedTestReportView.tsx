import { Alert, Anchor, Badge, Button, Group, Paper, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { IconAlertTriangle, IconCircleCheck, IconDownload, IconInfoCircle, IconUrgent } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { speedTestsApi } from '../../../api/speedTests';
import type { SpeedTestDetail, SpeedTestDirection, SpeedTestReport, SpeedTestSeverity, SpeedTestStats } from '../../../api/types';
import { ChartLegend } from '../../../components/charts/ChartLegend';
import { TimeSeriesChart } from '../../../components/charts/TimeSeriesChart';
import { formatDateTime } from '../../../lib/format';
import {
  formatBytes,
  formatMbps,
  formatMs,
  formatPct,
  gradeColor,
  NETWORK_TYPE_LABEL,
  QUALITY_INFO,
  RATING_INFO,
  SEVERITY_INFO,
} from './speedTestFormat';

const NOWRAP = { whiteSpace: 'nowrap' } as const;

const SEVERITY_ICON: Record<SpeedTestSeverity, ReactNode> = {
  critical: <IconUrgent size={18} />,
  warning: <IconAlertTriangle size={18} />,
  info: <IconInfoCircle size={18} />,
  ok: <IconCircleCheck size={18} />,
};

/** Relatorio completo de um teste concluido (o mesmo conteudo do PDF). */
export function SpeedTestReportView({ detail }: { detail: SpeedTestDetail }) {
  const { test, report, analysis } = detail;
  if (!report || !analysis) return null;
  const quality = QUALITY_INFO[analysis.quality];
  const seconds = report.startedAt && report.finishedAt ? Math.round((Date.parse(report.finishedAt) - Date.parse(report.startedAt)) / 1000) : null;
  const worstBloat = Math.max(analysis.downloadBloat?.addedMs ?? 0, analysis.uploadBloat?.addedMs ?? 0);

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <div>
          <Group gap="xs">
            <Text fw={600}>Qualidade geral da conexão:</Text>
            <Badge size="lg" color={quality.color} variant="filled">
              {quality.label}
            </Badge>
          </Group>
          <Text size="xs" c="dimmed" mt={4}>
            {formatDateTime(test.createdAt, '')} por {test.requestedBy} · teste {test.mode === 'quick' ? 'rápido' : 'completo'}
            {seconds !== null && ` · ${seconds} s`} · {formatBytes(report.bytesUsed)} transferidos · servidor {report.server.provider} {report.server.colo}
          </Text>
        </div>
        <Button component="a" href={speedTestsApi.pdfUrl(detail.agent.id, test.id)} download variant="light" leftSection={<IconDownload size={16} />}>
          Baixar PDF
        </Button>
      </Group>

      <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }} spacing="sm">
        <Tile label="Download" value={formatMbps(report.download.mbps)} note={planNote(analysis.planDownloadPct, test.planDownloadMbps) ?? directionNote(report.download)} />
        <Tile label="Upload" value={formatMbps(report.upload.mbps)} note={planNote(analysis.planUploadPct, test.planUploadMbps) ?? directionNote(report.upload)} />
        <Tile label="Latência" value={formatMs(analysis.latencyMs)} note="mediana, conexão ociosa" />
        <Tile label="Jitter" value={formatMs(analysis.jitterMs)} note="variação entre amostras" />
        <Tile label="Perda de pacotes" value={analysis.lossPct === null ? 'não medida' : formatPct(analysis.lossPct)} note="ICMP até 1.1.1.1 e 8.8.8.8" />
        <Tile
          label="Bufferbloat"
          value={
            analysis.bloatGrade ? (
              <Badge size="xl" color={gradeColor(analysis.bloatGrade)} variant="light">
                {analysis.bloatGrade}
              </Badge>
            ) : (
              'não medido'
            )
          }
          note={analysis.bloatGrade ? `latência sob carga +${formatMs(worstBloat)}` : 'só no teste completo'}
        />
      </SimpleGrid>

      <Section title="Diagnóstico">
        <Stack gap="xs">
          {analysis.findings.map((f, i) => (
            <Alert key={i} color={SEVERITY_INFO[f.severity].color} variant="light" icon={SEVERITY_ICON[f.severity]} title={f.title} p="sm">
              {f.detail}
            </Alert>
          ))}
        </Stack>
      </Section>

      <Section title="Adequação por uso">
        <Table.ScrollContainer minWidth={560}>
          <Table striped verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Uso</Table.Th>
                <Table.Th>Avaliação</Table.Th>
                <Table.Th>Detalhe</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {analysis.usage.map((u) => (
                <Table.Tr key={u.key}>
                  <Table.Td fw={500}>{u.label}</Table.Td>
                  <Table.Td>
                    <Badge color={RATING_INFO[u.rating].color} variant="light">
                      {RATING_INFO[u.rating].label}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c="dimmed">
                      {u.detail}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Section>

      <ThroughputChart report={report} />

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        <Section title="Conexão com a internet">
          <KeyValues
            rows={[
              ['IP público', report.connection.publicIp],
              ['Provedor (ASN)', report.connection.asn > 0 ? `AS${report.connection.asn}` : ''],
              ['Localização', [report.connection.city, report.connection.region, report.connection.country].filter(Boolean).join(', ')],
              ['Servidor de teste', `${report.server.provider} ${report.server.colo} (${report.server.host})`],
              ['Primeira conexão', `DNS ${formatMs(report.server.dnsMs)}, TCP ${formatMs(report.server.connectMs)}, TLS ${formatMs(report.server.tlsMs)}`],
              ['RTT do TCP (servidor)', report.server.tcpRttMs > 0 ? formatMs(report.server.tcpRttMs) : ''],
              ['Proxy', report.connection.proxy ? 'Sim, pelo proxy do agente' : 'Não'],
            ]}
          />
        </Section>
        <Section title="Rede local">
          <KeyValues rows={networkRows(report)} />
        </Section>
      </SimpleGrid>

      <Section title="Latência e perda de pacotes">
        <Table.ScrollContainer minWidth={720}>
          <Table striped verticalSpacing="xs" fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Destino</Table.Th>
                <Table.Th>Endereço</Table.Th>
                <Table.Th>Método</Table.Th>
                <Table.Th ta="right">Respostas</Table.Th>
                <Table.Th ta="right">Perda</Table.Th>
                <Table.Th ta="right">Mín.</Table.Th>
                <Table.Th ta="right">Mediana</Table.Th>
                <Table.Th ta="right">Máx.</Table.Th>
                <Table.Th ta="right">Jitter</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              <LatencyRow name="Servidor de teste (ociosa)" host={report.server.host} method="HTTP" answers={`${report.latency.idle.samples}`} loss="-" stats={report.latency.idle} />
              {report.latency.targets.map((t) =>
                t.error && t.received === 0 ? (
                  <Table.Tr key={t.host + t.kind}>
                    <Table.Td>{t.name}</Table.Td>
                    <Table.Td ff="monospace">{t.host}</Table.Td>
                    <Table.Td>{t.method.toUpperCase()}</Table.Td>
                    <Table.Td colSpan={6}>
                      <Text size="sm" c="dimmed">
                        Não medido: {t.error}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ) : (
                  <LatencyRow
                    key={t.host + t.kind}
                    name={t.name}
                    host={t.host}
                    method={t.method.toUpperCase()}
                    answers={`${t.received}/${t.sent}`}
                    loss={formatPct(t.lossPct)}
                    stats={t.stats}
                  />
                ),
              )}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Section>

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        <DirectionSection title="Download" direction={report.download} idle={report.latency.idle} grade={analysis.downloadBloat?.grade} />
        <DirectionSection title="Upload" direction={report.upload} idle={report.latency.idle} grade={analysis.uploadBloat?.grade} />
      </SimpleGrid>

      {report.dns.length > 0 && (
        <Section title="Resolução de nomes (DNS do sistema)">
          <Table striped verticalSpacing="xs" fz="sm">
            <Table.Tbody>
              {report.dns.map((d) => (
                <Table.Tr key={d.host}>
                  <Table.Td ff="monospace">{d.host}</Table.Td>
                  <Table.Td ta="right" style={NOWRAP}>{d.error ? '-' : formatMs(d.ms)}</Table.Td>
                  <Table.Td>
                    <Text size="sm" c="dimmed">
                      {d.error ? `Falhou: ${d.error}` : d.addresses.join(', ')}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Section>
      )}

      <Text size="xs" c="dimmed">
        Medido pelo EYES na própria máquina contra a infraestrutura de teste da Cloudflare (speed.cloudflare.com), com uma conexão em tamanhos crescentes e, no
        teste completo, várias conexões simultâneas. Wi-Fi, outros dispositivos usando a rede e o horário influenciam o resultado.{' '}
        <Anchor href="https://speed.cloudflare.com/about" target="_blank" rel="noreferrer" size="xs">
          Sobre a medição
        </Anchor>
      </Text>
    </Stack>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack gap="xs">
      <Title order={5}>{title}</Title>
      {children}
    </Stack>
  );
}

/** Separa a unidade do numero ("16,7 Mbit/s") para ela ficar menor e o cartao nao quebrar a linha. */
const UNIT_RE = /^(.*\d)\s(Mbit\/s|ms)$/;

function Tile({ label, value, note }: { label: string; value: ReactNode; note: string }) {
  const parts = typeof value === 'string' ? UNIT_RE.exec(value) : null;
  return (
    <Paper withBorder p="sm">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="xl" fw={700} style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }} component="div">
        {parts ? (
          <>
            {parts[1]}{' '}
            <Text span size="sm" fw={500} c="dimmed">
              {parts[2]}
            </Text>
          </>
        ) : (
          value
        )}
      </Text>
      <Text size="xs" c="dimmed">
        {note}
      </Text>
    </Paper>
  );
}

function KeyValues({ rows }: { rows: [string, string][] }) {
  return (
    <Table withRowBorders verticalSpacing={6} fz="sm">
      <Table.Tbody>
        {rows.map(([key, value]) => (
          <Table.Tr key={key}>
            <Table.Th w="40%" fw={500}>
              {key}
            </Table.Th>
            <Table.Td>{value || '-'}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

function LatencyRow({ name, host, method, answers, loss, stats }: { name: string; host: string; method: string; answers: string; loss: string; stats: SpeedTestStats }) {
  return (
    <Table.Tr>
      <Table.Td>{name}</Table.Td>
      <Table.Td ff="monospace">{host}</Table.Td>
      <Table.Td>{method}</Table.Td>
      <Table.Td ta="right" style={NOWRAP}>{answers}</Table.Td>
      <Table.Td ta="right" style={NOWRAP}>{loss}</Table.Td>
      <Table.Td ta="right" style={NOWRAP}>{formatMs(stats.minMs)}</Table.Td>
      <Table.Td ta="right" fw={600} style={NOWRAP}>
        {formatMs(stats.medianMs)}
      </Table.Td>
      <Table.Td ta="right" style={NOWRAP}>{formatMs(stats.maxMs)}</Table.Td>
      <Table.Td ta="right" style={NOWRAP}>{formatMs(stats.jitterMs)}</Table.Td>
    </Table.Tr>
  );
}

function DirectionSection({ title, direction: d, idle, grade }: { title: string; direction: SpeedTestDirection; idle: SpeedTestStats; grade?: string }) {
  if (d.mbps <= 0) {
    return (
      <Section title={title}>
        <Text size="sm" c="dimmed">
          {d.error ? `Não medido: ${d.error}` : 'Não medido.'}
        </Text>
      </Section>
    );
  }
  const rows: [string, string][] = [
    ['Resultado', formatMbps(d.mbps)],
    ['Uma conexão', formatMbps(d.singleMbps)],
  ];
  if (d.multiMbps > 0) rows.push([`${d.streams} conexões simultâneas`, formatMbps(d.multiMbps)]);
  if (d.loaded.samples > 0) {
    rows.push(['Latência sob carga', `mediana ${formatMs(d.loaded.medianMs)}, máxima ${formatMs(d.loaded.maxMs)} (ociosa ${formatMs(idle.medianMs)})${grade ? `, nota ${grade}` : ''}`]);
  }
  if (d.retransPct > 0) rows.push(['Retransmissões TCP', formatPct(d.retransPct)]);
  rows.push(['Dados transferidos', `${formatBytes(d.bytes)} em ${Math.round(d.durationMs / 1000)} s`]);
  return (
    <Section title={title}>
      <KeyValues rows={rows} />
      {d.stages.length > 0 && (
        <Table striped verticalSpacing={4} fz="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Transferência</Table.Th>
              <Table.Th ta="right">Vezes</Table.Th>
              <Table.Th ta="right">Mediana</Table.Th>
              <Table.Th ta="right">Máxima</Table.Th>
              <Table.Th ta="right">Tempo</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {d.stages.map((s) => (
              <Table.Tr key={s.bytes}>
                <Table.Td>{formatBytes(s.bytes)}</Table.Td>
                <Table.Td ta="right" style={NOWRAP}>{s.count}</Table.Td>
                <Table.Td ta="right" style={NOWRAP}>{formatMbps(s.medianMbps)}</Table.Td>
                <Table.Td ta="right" style={NOWRAP}>{formatMbps(s.maxMbps)}</Table.Td>
                <Table.Td ta="right" style={NOWRAP}>{formatMs(s.medianMs)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Section>
  );
}

/** Vazao na fase com varias conexoes: download e upload no mesmo eixo de segundos. */
function ThroughputChart({ report }: { report: SpeedTestReport }) {
  const series = [
    { key: 'download', label: 'Download', color: 'var(--ce-chart-1)', direction: report.download },
    { key: 'upload', label: 'Upload', color: 'var(--ce-chart-2)', direction: report.upload },
  ]
    .filter((s) => s.direction.timeline.length > 1)
    .map((s) => ({
      key: s.key,
      label: s.label,
      color: s.color,
      points: s.direction.timeline.map((value, i) => ({ time: new Date((i + 1) * (s.direction.timelineStepMs || 500)).toISOString(), value })),
    }));
  if (series.length === 0) return null;
  return (
    <Section title="Vazão com várias conexões">
      <ChartLegend items={series.map((s) => ({ label: s.label, color: s.color }))} />
      <TimeSeriesChart
        series={series}
        label="Vazão de download e upload ao longo do teste"
        formatValue={(v) => formatMbps(v)}
        formatTick={(v) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}
        formatTime={(ms) => `${(ms / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s`}
      />
      <Text size="xs" c="dimmed">
        Mbit/s em janelas de 1 s, com 6 conexões ao mesmo tempo. Os 2 primeiros segundos (partida das conexões) não entram no resultado.
      </Text>
    </Section>
  );
}

function planNote(pct: number | null, plan: number | null): string | null {
  return pct !== null && plan !== null ? `${formatPct(pct)} do plano de ${formatMbps(plan)}` : null;
}

function directionNote(d: SpeedTestDirection): string {
  return d.multiMbps > 0 ? `1 conexão ${formatMbps(d.singleMbps)}` : 'uma conexão';
}

function networkRows(report: SpeedTestReport): [string, string][] {
  const n = report.network;
  const rows: [string, string][] = [
    ['Interface', [n.interface, n.description].filter(Boolean).join(' - ')],
    ['Tipo', NETWORK_TYPE_LABEL[n.type] ?? '-'],
    ['IP local / MAC', [n.localIp, n.mac].filter(Boolean).join(' / ')],
    ['Velocidade do link', n.linkMbps > 0 ? formatMbps(n.linkMbps) : ''],
    ['Gateway', n.gateway],
    ['Servidores DNS', n.dnsServers.join(', ')],
  ];
  const w = n.wifi;
  if (w) {
    rows.push(
      ['Rede Wi-Fi', [w.ssid, w.bssid].filter(Boolean).join(' - ')],
      ['Sinal', [w.signalPct > 0 ? `${w.signalPct}%` : '', w.rssiDbm < 0 ? `${w.rssiDbm} dBm` : '', w.noiseDbm < 0 ? `ruído ${w.noiseDbm} dBm` : ''].filter(Boolean).join(', ')],
      ['Canal / banda / padrão', [w.channel > 0 ? String(w.channel) : '', w.band, w.radio].filter(Boolean).join(' / ')],
      ['Taxa do Wi-Fi', `recepção ${formatMbps(w.rxMbps)}, transmissão ${formatMbps(w.txMbps)}`],
    );
  }
  return rows;
}
