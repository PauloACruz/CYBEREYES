import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SpeedTestDetail, SpeedTestStats, SpeedTestSummary } from '../../../api/types';
import { makeAgentDetail } from '../../../test/fixtures';
import { json, makeMe, mockFetch, renderApp } from '../../../test/utils';

const stats = (median: number): SpeedTestStats => ({ samples: 10, minMs: median - 2, medianMs: median, avgMs: median, p90Ms: median + 3, maxMs: median + 5, jitterMs: 2.5 });

function summary(overrides: Partial<SpeedTestSummary> = {}): SpeedTestSummary {
  return {
    id: 7,
    mode: 'full',
    status: 'completed',
    phase: null,
    progress: 100,
    liveMbps: null,
    requestedBy: 'Maria Silva',
    createdAt: '2026-10-22T14:00:00Z',
    finishedAt: '2026-10-22T14:00:45Z',
    downloadMbps: 312.4,
    uploadMbps: 48.2,
    latencyMs: 12.3,
    jitterMs: 2.5,
    lossPct: 0,
    planDownloadMbps: 300,
    planUploadMbps: 50,
    error: null,
    ...overrides,
  };
}

const direction = (mbps: number) => ({
  mbps,
  singleMbps: mbps * 0.8,
  multiMbps: mbps,
  streams: 6,
  stages: [{ bytes: 10_000_000, count: 4, medianMbps: mbps * 0.8, maxMbps: mbps * 0.85, medianMs: 260 }],
  timeline: [mbps * 0.5, mbps, mbps],
  timelineStepMs: 500,
  loaded: stats(40),
  retransPct: 0.1,
  bytes: 250_000_000,
  durationMs: 21_000,
  error: '',
});

const completed: SpeedTestDetail = {
  test: summary(),
  agent: { id: 1, hostname: 'estacao-01', clientName: 'Cliente', siteName: 'Matriz', plat: 'windows', version: '3.4.0' },
  report: {
    mode: 'full',
    startedAt: '2026-10-22T14:00:00Z',
    finishedAt: '2026-10-22T14:00:45Z',
    server: { provider: 'Cloudflare', host: 'speed.cloudflare.com', colo: 'GRU', dnsMs: 1, connectMs: 10, tlsMs: 20, tcpRttMs: 11 },
    connection: { publicIp: '189.54.138.55', asn: 28573, city: 'São Paulo', region: '', country: 'BR', timezone: 'America/Sao_Paulo', proxy: false },
    network: {
      interface: 'Wi-Fi',
      description: 'Intel AX201',
      type: 'wifi',
      localIp: '192.168.1.20',
      mac: 'A0:B1:C2:D3:E4:F5',
      mtu: 1500,
      linkMbps: 866,
      gateway: '192.168.1.1',
      dnsServers: ['192.168.1.1'],
      wifi: { ssid: 'Escritorio', bssid: '', signalPct: 88, rssiDbm: -52, noiseDbm: 0, channel: 36, band: '5 GHz', radio: '802.11ac', rxMbps: 866, txMbps: 780 },
    },
    latency: {
      idle: stats(12.3),
      targets: [
        { kind: 'gateway', name: 'Gateway da rede local', host: '192.168.1.1', method: 'icmp', sent: 10, received: 10, lossPct: 0, stats: stats(2), error: '' },
        { kind: 'internet', name: 'Google DNS', host: '8.8.8.8', method: 'icmp', sent: 0, received: 0, lossPct: 0, stats: stats(0), error: 'sem permissão' },
      ],
    },
    dns: [{ host: 'www.google.com', ms: 18, addresses: ['142.251.154.119'], error: '' }],
    download: direction(312.4),
    upload: direction(48.2),
    bytesUsed: 500_000_000,
    warnings: [],
  },
  analysis: {
    quality: 'excellent',
    latencyMs: 12.3,
    jitterMs: 2.5,
    lossPct: 0,
    serverLatencyMs: 30,
    downloadBloat: { loadedMs: 40, addedMs: 27.7, grade: 'A' },
    uploadBloat: { loadedMs: 40, addedMs: 27.7, grade: 'A' },
    bloatGrade: 'A',
    planDownloadPct: 104.1,
    planUploadPct: 96.4,
    usage: [{ key: 'video_calls', label: 'Videochamadas (Teams, Meet, Zoom)', rating: 'great', detail: 'Tudo certo' }],
    findings: [{ severity: 'ok', title: 'Nenhum problema encontrado', detail: 'Velocidade, latência e estabilidade dentro do esperado.' }],
  },
};

function sentBody(fetchMock: ReturnType<typeof mockFetch>, path: string): unknown {
  const call = fetchMock.mock.calls.find(([input, init]) => init?.method === 'POST' && new URL(typeof input === 'string' ? input : '', 'http://x').pathname === path);
  return call?.[1]?.body ? JSON.parse(call[1].body as string) : undefined;
}

// A pagina da maquina carrega sob demanda: com a suite inteira em paralelo passa facil de 1 s.
const SLOW = { timeout: 10_000 };

async function openSpeedTest() {
  const user = userEvent.setup();
  // Pagina do agente inteira carregada (a rota e o menu sao carregados sob demanda) antes de abrir o menu.
  expect(await screen.findByRole('tab', { name: /Inicialização/ }, SLOW)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Ações' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Teste de velocidade', hidden: true }, SLOW));
  return { user, dialog: await screen.findByRole('dialog', {}, SLOW) };
}

describe('teste de velocidade', { timeout: 30_000 }, () => {
  afterEach(() => vi.unstubAllGlobals());

  it('inicia pelo menu Ações, acompanha o andamento e mostra o relatório', async () => {
    let started = false;
    let polls = 0;
    const fetchMock = mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['agents.view', 'agents.control'] })),
      'GET /api/url-actions': () => json([]),
      'GET /api/agents/1': () => json(makeAgentDetail({ plat: 'windows', version: '3.4.0' })),
      'GET /api/agents/1/speedtests': () => json(started ? [summary({ status: polls > 0 ? 'completed' : 'running' })] : []),
      'POST /api/agents/1/speedtests': () => {
        started = true;
        return json(summary({ status: 'pending', progress: 0, downloadMbps: null }), 201);
      },
      'GET /api/agents/1/speedtests/7': () =>
        json(polls++ === 0 ? { ...completed, test: summary({ status: 'running', phase: 'download', progress: 45, liveMbps: 287.6 }), report: null, analysis: null } : completed),
    });
    renderApp('/agentes/1');
    const { user, dialog } = await openSpeedTest();

    expect(await within(dialog).findByText('Nenhum teste de velocidade feito nesta máquina ainda.', {}, SLOW)).toBeInTheDocument();
    await user.type(within(dialog).getByRole('textbox', { name: /Download contratado/ }), '300');
    await user.click(within(dialog).getByRole('button', { name: 'Iniciar teste' }));

    expect(await within(dialog).findByText('Medindo a conexão desta máquina', {}, SLOW)).toBeInTheDocument();
    expect(within(dialog).getByText('288 Mbit/s')).toBeInTheDocument();
    expect(sentBody(fetchMock, '/api/agents/1/speedtests')).toEqual({ mode: 'full', planDownloadMbps: 300, planUploadMbps: null });

    expect(await within(dialog).findByText('Excelente', {}, SLOW)).toBeInTheDocument();
    expect(within(dialog).getByText('Nenhum problema encontrado')).toBeInTheDocument();
    expect(within(dialog).getAllByText('312 Mbit/s').length).toBeGreaterThan(0);
    expect(within(dialog).getByText('104,1% do plano de 300 Mbit/s')).toBeInTheDocument();
    expect(within(dialog).getByText('Não medido: sem permissão')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: /Baixar PDF/ })).toHaveAttribute('href', '/api/agents/1/speedtests/7/pdf');
  });

  it('sem agents.control mostra só o histórico, e avisa quando o EYES é antigo', async () => {
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['agents.view'] })),
      'GET /api/url-actions': () => json([]),
      'GET /api/agents/1': () => json(makeAgentDetail({ plat: 'windows', version: '3.3.0' })),
      'GET /api/agents/1/speedtests': () => json([summary({ id: 8, status: 'failed', error: 'O agente parou de informar o andamento do teste', downloadMbps: null })]),
      'GET /api/agents/1/speedtests/8': () =>
        json({ ...completed, test: summary({ id: 8, status: 'failed', error: 'O agente parou de informar o andamento do teste' }), report: null, analysis: null }),
    });
    renderApp('/agentes/1');
    const { dialog } = await openSpeedTest();

    expect(await within(dialog).findByText(/Disponível a partir do EYES 3.4.0/, {}, SLOW)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Iniciar teste' })).not.toBeInTheDocument();
    expect(await within(dialog).findByText('O teste falhou', {}, SLOW)).toBeInTheDocument();
    expect(within(dialog).getAllByText('O agente parou de informar o andamento do teste').length).toBeGreaterThan(0);
  });
});
