import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AlertDto, BulkAlertRequest } from '../../api/types';
import { json, makeMe, mockFetch, renderApp } from '../../test/utils';

function makeAlert(overrides: Partial<AlertDto>): AlertDto {
  return {
    id: 1,
    agentId: 1,
    hostname: 'PC-RECEPCAO',
    clientName: 'Clínica Central',
    siteName: 'Matriz',
    alertType: 'check',
    checkId: 10,
    taskId: null,
    severity: 'error',
    message: 'Disco C: com pouco espaço',
    createdAt: '2026-10-01T10:00:00Z',
    resolved: false,
    resolvedAt: null,
    snoozedUntil: null,
    emailSent: false,
    webhookSent: false,
    ...overrides,
  };
}

const alerts = [
  makeAlert({ id: 1 }),
  makeAlert({ id: 2, hostname: 'SRV-ARQUIVOS', severity: 'warning', message: 'CPU acima de 85%' }),
  makeAlert({ id: 3, hostname: 'PC-CAIXA', alertType: 'availability', severity: 'info', message: 'Agente offline' }),
];

describe('página de Alertas', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('seleciona vários alertas e resolve em lote', async () => {
    let sent: BulkAlertRequest | undefined;
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['alerts.view', 'alerts.manage'] })),
      'GET /api/alerts': () => json({ items: alerts, total: alerts.length, page: 1, pageSize: 50 }),
      'POST /api/alerts/bulk': (init) => {
        sent = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as BulkAlertRequest;
        return new Response(null, { status: 204 });
      },
    });
    renderApp('/alertas');
    const user = userEvent.setup();

    expect(await screen.findByText('CPU acima de 85%')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'SRV-ARQUIVOS' })).toHaveAttribute('href', '/agentes/1?aba=alertas');
    expect(screen.queryByRole('region', { name: 'Ações em lote' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Selecionar alerta Disco C: com pouco espaço' }));
    await user.click(screen.getByRole('checkbox', { name: 'Selecionar alerta CPU acima de 85%' }));

    const bar = screen.getByRole('region', { name: 'Ações em lote' });
    expect(within(bar).getByText('2 alertas selecionados')).toBeInTheDocument();
    await user.click(within(bar).getByRole('button', { name: 'Resolver' }));

    await waitFor(() => expect(sent).toEqual({ ids: [1, 2], action: 'resolve' }));
    expect(await screen.findByText('2 alertas resolvidos.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Ações em lote' })).not.toBeInTheDocument());
  });

  it('não mostra a seleção sem a permissão alerts.manage', async () => {
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['alerts.view'] })),
      'GET /api/alerts': () => json({ items: alerts, total: alerts.length, page: 1, pageSize: 50 }),
    });
    renderApp('/alertas');

    expect(await screen.findByText('Agente offline')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});
