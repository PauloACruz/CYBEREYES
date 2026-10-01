import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SaveCheckRequest } from '../../../api/types';
import { makeAgentDetail } from '../../../test/fixtures';
import { json, makeMe, mockFetch, renderApp } from '../../../test/utils';

const me = makeMe({ permissions: ['agents.view', 'agents.run', 'checks.manage'] });

async function chooseType(label: string) {
  const user = userEvent.setup();
  const dialog = screen.getByRole('dialog');
  await user.click(within(dialog).getByRole('combobox', { name: 'Tipo' }));
  await user.click(await screen.findByRole('option', { name: label, hidden: true }));
}

describe('formulário de check do agente', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('muda os campos conforme o tipo e envia o corpo correto para espaço em disco', async () => {
    let sent: SaveCheckRequest | undefined;
    mockFetch({
      'GET /api/auth/me': () => json(me),
      'GET /api/agents/1': () => json(makeAgentDetail({ disks: [{ device: 'C:', fstype: 'NTFS', total: '100 GB', used: '50 GB', free: '50 GB', percent: 50 }] })),
      'GET /api/agents/1/checks': () => json([]),
      'POST /api/checks': (init) => {
        sent = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as SaveCheckRequest;
        return json({ ...sent, id: 9 }, 201);
      },
    });
    renderApp('/agentes/1?aba=checks');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Novo check' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('combobox', { name: /^Disco/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: /Aviso abaixo de \(% livre\)/ })).toBeInTheDocument();

    await chooseType('Carga de CPU');
    await waitFor(() => expect(within(dialog).queryByRole('combobox', { name: /^Disco/ })).not.toBeInTheDocument());
    expect(within(dialog).getByRole('textbox', { name: /Aviso acima de \(%\)/ })).toBeInTheDocument();

    await chooseType('Ping');
    expect(await within(dialog).findByRole('textbox', { name: /^Endereço/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox', { name: /Aviso acima/ })).not.toBeInTheDocument();

    await chooseType('Espaço em disco');
    const disk = await within(dialog).findByRole('combobox', { name: /^Disco/ });
    await user.type(disk, 'C:');
    const warning = within(dialog).getByRole('textbox', { name: /Aviso abaixo de/ });
    await user.clear(warning);
    await user.type(warning, '30');
    await user.click(within(dialog).getByRole('button', { name: 'Criar check' }));

    await waitFor(() => expect(sent).toBeDefined());
    expect(sent).toEqual({
      agentId: 1,
      policyId: null,
      checkType: 'diskspace',
      name: '',
      runInterval: 0,
      failsBeforeAlert: 1,
      alertSeverity: 'warning',
      warningThreshold: 30,
      errorThreshold: 10,
      disk: 'C:',
      ip: null,
      scriptId: null,
      scriptArgs: [],
      envVars: [],
      timeout: null,
      infoReturnCodes: [],
      warningReturnCodes: [],
      successReturnCodes: [],
      svcName: null,
      passIfStartPending: false,
      passIfSvcNotExist: false,
      restartIfStopped: false,
      logName: null,
      eventId: null,
      eventIdIsWildcard: false,
      eventType: null,
      eventSource: null,
      eventMessage: null,
      failWhen: 'contains',
      searchLastDays: 1,
      numberOfEventsBeforeAlert: 1,
      emailAlert: false,
      webhookAlert: false,
      dashboardAlert: true,
    });
  });
});
