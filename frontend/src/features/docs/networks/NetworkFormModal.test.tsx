import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SaveNetworkRequest } from '../../../api/types';
import { CLIENTS } from '../../../test/fixtures';
import { json, makeMe, mockFetch, renderApp } from '../../../test/utils';

describe('formulário de rede', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('recusa CIDR e gateway inválidos antes de enviar', async () => {
    let sent: SaveNetworkRequest | undefined;
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['docs.view', 'docs.manage'] })),
      'GET /api/clients': () => json(CLIENTS),
      'GET /api/networks': () => json([]),
      'POST /api/networks': (init) => {
        sent = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as SaveNetworkRequest;
        return json({ id: 1, clientName: 'Clínica Central', siteName: null, usedCount: 0, totalHosts: 254, ...sent }, 201);
      },
    });
    renderApp('/documentacao?cliente=1');

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Nova rede' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nova rede' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Nome' }), 'Administrativa');
    const cidr = within(dialog).getByRole('textbox', { name: 'Faixa (CIDR)' });
    await user.type(cidr, '192.168.1.300/24');
    await user.type(within(dialog).getByRole('textbox', { name: 'Gateway' }), '10.0.0.1');
    await user.click(within(dialog).getByRole('button', { name: 'Cadastrar rede' }));

    expect(await within(dialog).findByText('CIDR inválido. Use, por exemplo, 192.168.1.0/24')).toBeInTheDocument();
    expect(sent).toBeUndefined();

    await user.clear(cidr);
    await user.type(cidr, '192.168.1.10/24');
    expect(within(dialog).getByText('Será gravada como 192.168.1.0/24')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cadastrar rede' }));
    expect(await within(dialog).findByText('O gateway precisa estar dentro da rede')).toBeInTheDocument();
    expect(sent).toBeUndefined();

    const gateway = within(dialog).getByRole('textbox', { name: 'Gateway' });
    await user.clear(gateway);
    await user.type(gateway, '192.168.1.1');
    await user.click(within(dialog).getByRole('button', { name: 'Cadastrar rede' }));

    await waitFor(() => expect(sent).toMatchObject({ clientId: 1, name: 'Administrativa', cidr: '192.168.1.10/24', gateway: '192.168.1.1' }));
  });
});
