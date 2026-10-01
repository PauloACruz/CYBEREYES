import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SaveSnmpDeviceRequest, SnmpCollectorDto } from '../../api/types';
import { CLIENTS } from '../../test/fixtures';
import { json, makeMe, mockFetch, renderApp } from '../../test/utils';

const COLLECTORS: SnmpCollectorDto[] = [
  { agentId: 1, hostname: 'SRV-COLETOR', clientId: 1, siteId: 10, status: 'online', version: '2.13.0', deviceCount: 3 },
  { agentId: 9, hostname: 'OUTRO-CLIENTE', clientId: 2, siteId: 20, status: 'online', version: '2.13.0', deviceCount: 0 },
];

/** Abre o Select e escolhe a opcao na lista ligada a ele (a pagina tem outro Select com as mesmas opcoes). */
async function pick(user: ReturnType<typeof userEvent.setup>, combobox: HTMLElement, option: string) {
  await user.click(combobox);
  const listbox = await waitFor(() => {
    const el = document.getElementById(combobox.getAttribute('aria-controls') ?? '');
    if (!el) throw new Error('lista não aberta');
    return el;
  });
  await user.click(await within(listbox).findByRole('option', { name: option, hidden: true }));
}

describe('formulário de dispositivo SNMP', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('alterna entre v2c e v3 e testa a conexão com os dados digitados', async () => {
    let tested: SaveSnmpDeviceRequest | undefined;
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['snmp.view', 'snmp.manage', 'clients.view'] })),
      'GET /api/snmp/devices': () => json([]),
      'GET /api/clients': () => json(CLIENTS),
      'GET /api/snmp/collectors': () => json(COLLECTORS),
      'POST /api/snmp/devices/test': (init) => {
        tested = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as SaveSnmpDeviceRequest;
        return json({ reachable: true, error: null, rttMs: 12, system: { name: 'SW-RECEPCAO', descr: 'Switch gerenciável 24 portas' } });
      },
    });
    renderApp('/snmp');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Novo dispositivo' }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo dispositivo SNMP' });

    await pick(user, within(dialog).getByRole('combobox', { name: 'Cliente' }), 'Clínica Central');
    await pick(user, within(dialog).getByRole('combobox', { name: 'Coletor' }), 'SRV-COLETOR');
    expect(screen.queryByRole('option', { name: 'OUTRO-CLIENTE', hidden: true })).not.toBeInTheDocument();
    await user.type(within(dialog).getByRole('textbox', { name: 'Nome' }), 'Switch recepção');
    await user.type(within(dialog).getByRole('textbox', { name: 'Endereço (IP ou nome)' }), '192.168.1.2');

    expect(within(dialog).getByLabelText(/Comunidade/)).toHaveAttribute('type', 'password');
    expect(within(dialog).queryByRole('textbox', { name: 'Usuário' })).not.toBeInTheDocument();

    await user.click(within(dialog).getByText('v3'));
    expect(within(dialog).queryByLabelText(/Comunidade/)).not.toBeInTheDocument();
    await user.type(within(dialog).getByRole('textbox', { name: 'Usuário' }), 'monitor');
    await user.type(within(dialog).getByLabelText(/Senha de autenticação/), 'segredo-auth');
    await user.type(within(dialog).getByLabelText(/Senha de criptografia/), 'segredo-priv');

    await user.click(within(dialog).getByRole('button', { name: 'Testar conexão' }));

    expect(await within(dialog).findByText('Conexão bem-sucedida')).toBeInTheDocument();
    expect(within(dialog).getByText('sysName: SW-RECEPCAO')).toBeInTheDocument();
    expect(within(dialog).getByText('Tempo de resposta: 12 ms')).toBeInTheDocument();
    await waitFor(() =>
      expect(tested).toMatchObject({
        clientId: 1,
        collectorAgentId: 1,
        host: '192.168.1.2',
        version: 'v3',
        v3: {
          username: 'monitor',
          securityLevel: 'authPriv',
          authProtocol: 'SHA256',
          authPassword: 'segredo-auth',
          privProtocol: 'AES',
          privPassword: 'segredo-priv',
        },
      }),
    );
    expect(tested).not.toHaveProperty('community');
  });
});
