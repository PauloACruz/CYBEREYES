import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeAgentDetail } from '../../../test/fixtures';
import { json, makeMe, mockFetch, renderApp } from '../../../test/utils';

const control = makeMe({ permissions: ['agents.view', 'agents.control'] });
const domainWmi = { comp_sys: [[{ PartOfDomain: true, Domain: 'empresa.local' }]] };

function renameBody(fetchMock: ReturnType<typeof mockFetch>): unknown {
  const call = fetchMock.mock.calls.find(([input, init]) => init?.method === 'POST' && String(input).endsWith('/api/agents/1/rename'));
  return call?.[1]?.body ? JSON.parse(call[1].body as string) : undefined;
}

describe('renomear computador', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renomeia pelo lápis ao lado do hostname, com a credencial do domínio', async () => {
    const fetchMock = mockFetch({
      'GET /api/auth/me': () => json(control),
      'GET /api/agents/1': () => json(makeAgentDetail({ plat: 'windows', wmi: domainWmi })),
      'POST /api/agents/1/rename': () =>
        json({ historyId: 9, retcode: 0, result: 'OK - PC-RECEPCAO -> PC-FIN-012 (renomeado); reinício agendado em 300 s', stdout: '', stderr: '' }),
    });
    renderApp('/agentes/1');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Renomear computador' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/domínio empresa.local/)).toBeInTheDocument();

    await user.type(within(dialog).getByRole('textbox', { name: /Novo nome/ }), 'PC FIN');
    await user.click(within(dialog).getByRole('button', { name: 'Renomear' }));
    expect(await within(dialog).findByText('Use só letras sem acento, números e hífen')).toBeInTheDocument();
    expect(within(dialog).getByText('Informe o usuário e a senha do domínio')).toBeInTheDocument();

    const nameInput = within(dialog).getByRole('textbox', { name: /Novo nome/ });
    await user.clear(nameInput);
    await user.type(nameInput, 'PC-FIN-012');
    await user.type(within(dialog).getByRole('textbox', { name: /Usuário do domínio/ }), 'EMPRESA\\ti');
    await user.type(within(dialog).getByLabelText(/Senha do domínio/), 'senha-do-dominio');
    await user.click(within(dialog).getByRole('button', { name: 'Renomear' }));

    expect(await screen.findByText(/reinício agendado em 300 s/)).toBeInTheDocument();
    expect(renameBody(fetchMock)).toEqual({ newName: 'PC-FIN-012', restart: true, domainUser: 'EMPRESA\\ti', domainPassword: 'senha-do-dominio' });
  });

  it('mostra a falha do script e mantém o formulário aberto', async () => {
    mockFetch({
      'GET /api/auth/me': () => json(control),
      'GET /api/agents/1': () => json(makeAgentDetail({ plat: 'windows', wmi: { comp_sys: [[{ PartOfDomain: false, Workgroup: 'WORKGROUP' }]] } })),
      'POST /api/agents/1/rename': () =>
        json({ historyId: 9, retcode: 3, result: 'DESCONHECIDO - Autoridade Certificadora instalada', stdout: '', stderr: '' }),
    });
    renderApp('/agentes/1');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Renomear computador' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('textbox', { name: /Usuário do domínio/ })).not.toBeInTheDocument();
    await user.type(within(dialog).getByRole('textbox', { name: /Novo nome/ }), 'SRV-CA');
    await user.click(within(dialog).getByRole('checkbox', { name: /Reiniciar/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Renomear' }));

    expect(await within(dialog).findByText(/Autoridade Certificadora instalada/)).toBeInTheDocument();
  });

  it('não mostra o lápis sem permissão de controle ou fora do Windows', async () => {
    mockFetch({
      'GET /api/auth/me': () => json(control),
      'GET /api/agents/1': () => json(makeAgentDetail({ plat: 'linux' })),
    });
    renderApp('/agentes/1');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('button', { name: 'Renomear computador' })).not.toBeInTheDocument();
  });
});
