import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, makeMe, mockFetch, renderApp } from '../../test/utils';
import { makeSnmpDetail } from './snmpTestData';

describe('detalhe do dispositivo SNMP', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('mostra as interfaces com taxas humanizadas e liga o monitoramento', async () => {
    let sent: { url: string; body: unknown } | undefined;
    let detail = makeSnmpDetail();
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['snmp.view', 'snmp.manage'] })),
      'GET /api/snmp/devices/5': () => json(detail),
      'GET /api/snmp/devices/5/metrics': (_init, url) => json({ metric: url.searchParams.get('metric'), points: [] }),
      'PUT /api/snmp/devices/5/interfaces/2': (init, url) => {
        sent = { url: url.pathname, body: JSON.parse(typeof init?.body === 'string' ? init.body : '{}') };
        detail = { ...detail, interfaces: detail.interfaces.map((i) => (i.index === 2 ? { ...i, monitored: true } : i)) };
        return new Response(null, { status: 204 });
      },
    });
    renderApp('/snmp/5');
    const user = userEvent.setup();

    const table = await screen.findByRole('table', { name: 'Interfaces' });
    expect(screen.getByRole('heading', { name: 'Switch recepção' })).toBeInTheDocument();
    expect(screen.getByText('Ativo')).toBeInTheDocument();
    const uplink = within(table).getByRole('row', { name: /Gi0\/1/ });
    expect(within(uplink).getByText('94,3 Mbps')).toBeInTheDocument();
    expect(within(uplink).getByText('1,5 kbps')).toBeInTheDocument();
    expect(within(uplink).getByText('1 Gbps')).toBeInTheDocument();
    expect(within(table).getByText('Desconectada')).toBeInTheDocument();

    const toggle = within(table).getByRole('switch', { name: 'Monitorar Gi0/2' });
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    await waitFor(() => expect(sent).toEqual({ url: '/api/snmp/devices/5/interfaces/2', body: { monitored: true } }));
    expect(within(table).getByRole('switch', { name: 'Monitorar Gi0/2' })).toBeChecked();

    await user.click(within(uplink).getByText('Uplink'));
    expect(await screen.findByText('Tráfego de Gi0/1')).toBeInTheDocument();
  });
});
