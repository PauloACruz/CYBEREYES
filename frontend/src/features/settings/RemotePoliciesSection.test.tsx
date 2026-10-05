import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RemotePolicyDto } from '../../api/types';
import { json, makeMe, mockFetch, renderApp } from '../../test/utils';

const global: RemotePolicyDto = {
  scope: 'global', scopeId: 0, consent: 'none', consentTimeoutSeconds: 60, allowAtLoginScreen: true, clipboardToRemote: true, clipboardToLocal: true,
  filesUpload: true, filesDownload: true, maxFileMb: 2048, idleMinutes: 30, maxHours: 8, updatedAt: null, updatedBy: null,
};
const site: RemotePolicyDto = {
  ...global, scope: 'site', scopeId: 7, consent: 'ask', consentTimeoutSeconds: null, allowAtLoginScreen: null, clipboardToRemote: null,
  clipboardToLocal: false, filesUpload: null, filesDownload: null, maxFileMb: null, idleMinutes: null, maxHours: null,
};

describe('politicas do acesso remoto nas configuracoes', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('liga o pedido de permissao na politica global e mostra as excecoes', async () => {
    const saved: unknown[] = [];
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['settings.manage'] })),
      'GET /api/remote/policies': () => json([global, site]),
      'PUT /api/remote/policies/global': (init) => {
        saved.push(JSON.parse(init?.body as string));
        return json({ ...global, consent: 'ask' });
      },
      'GET /api/clients': () => json([{ id: 3, name: 'Contoso', agentCount: 2, sites: [{ id: 7, clientId: 3, name: 'Filial', agentCount: 2 }] }]),
      'GET /api/ticket-queues': () => json([]),
      'GET /api/tickets/sla': () => json([]),
      'GET /api/tickets/incident-settings': () => json({ enabled: true, severities: ['error'], priority: 'high', queueId: null, resolveWithAlert: true }),
    });
    renderApp('/configuracoes');
    const section = await screen.findByRole('region', { name: 'Acesso remoto' });
    const user = userEvent.setup();

    expect(await within(section).findByText('Site Contoso / Filial')).toBeInTheDocument();
    expect(within(section).getByText('Pedir permissão ao usuário')).toBeInTheDocument();
    expect(within(section).getByText('Área de transferência da máquina para o técnico: não')).toBeInTheDocument();

    const consent = within(section).getByRole('combobox', { name: 'Aviso ao usuário da máquina' });
    expect(consent).toHaveValue('Não avisar');
    await user.click(consent);
    await user.click(await screen.findByRole('option', { name: 'Pedir permissão ao usuário', hidden: true }));
    await user.click(within(section).getByRole('button', { name: 'Salvar política global' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toMatchObject({ scope: 'global', consent: 'ask', maxFileMb: 2048 });
  });
});
