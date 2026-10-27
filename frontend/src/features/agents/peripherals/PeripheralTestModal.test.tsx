import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PeripheralState, PeripheralTest } from '../../../api/types';
import { makeAgentDetail } from '../../../test/fixtures';
import { json, makeMe, mockFetch, renderApp } from '../../../test/utils';

const SLOW = { timeout: 10_000 };

function peripheralTest(overrides: Partial<PeripheralTest> = {}): PeripheralTest {
  return {
    id: 5,
    agentId: 1,
    section: 'keyboard',
    status: 'pending',
    requestedBy: 'Ana Souza',
    username: null,
    createdAt: '2026-10-27T15:00:00Z',
    updatedAt: new Date().toISOString(),
    connectedAt: null,
    endedAt: null,
    endedBy: null,
    state: null,
    ...overrides,
  };
}

// Teclado ABNT2 com o Windows em inglês (EUA), como o app de bandeja manda.
const state: PeripheralState = {
  section: 'keyboard',
  hostname: 'ESTACAO-01',
  supported: true,
  devices: [
    { id: 'kb', kind: 'keyboard', name: 'Dispositivo de teclado HID', model: 'USB Receiver', bus: 'USB', ok: true },
    { id: 'u1', kind: 'usb', name: 'SanDisk 3.2Gen1', bus: 'USB', ok: true },
  ],
  keyboard: {
    layout: { id: '00000409', name: 'Inglês (Estados Unidos)' },
    reference: 'Maçã; pé',
    typed: "Ma;'a/ p[e",
    ops: [
      { t: 'm', g: 'M' },
      { t: 'm', g: 'a' },
      { t: 's', e: 'ç', g: ';' },
      { t: 's', e: 'ã', g: "'" },
      { t: 'i', g: 'a' },
    ],
    verdict: 'mismatch',
    message: 'O teclado é ABNT2 (brasileiro, com a tecla Ç), mas o sistema está configurado como americano. Ajuste o layout para Português (Brasil ABNT2).',
    model: 'ABNT2 (brasileiro, com a tecla Ç)',
    differences: ['A tecla “ç” escreveu “;” (tecla Semicolon)'],
    pressed: ['KeyM', 'KeyA', 'Semicolon', 'IntlRo'],
    down: ['IntlRo'],
    layoutKeys: { Semicolon: ';', KeyM: 'm' },
    others: [],
    tested: 4,
    total: 85,
  },
  results: {
    keyboard: ['Layout configurado: Inglês (Estados Unidos) (00000409)', 'Resultado: Ajuste o layout para Português (Brasil ABNT2).'],
    pointer: null,
    usb: null,
    camera: null,
  },
};

async function openPeripheralTest() {
  const user = userEvent.setup();
  expect(await screen.findByRole('tab', { name: /Inicialização/ }, SLOW)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Ações' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Teste de teclado, mouse, USB e câmera', hidden: true }, SLOW));
  return { user, dialog: await screen.findByRole('dialog', {}, SLOW) };
}

describe('teste de periféricos', { timeout: 30_000 }, () => {
  afterEach(() => vi.unstubAllGlobals());

  it('abre o teste no app do usuário e mostra ao vivo o que ele digita', async () => {
    let current: PeripheralTest | null = null;
    const fetchMock = mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['agents.view', 'agents.control'] })),
      'GET /api/url-actions': () => json([]),
      'GET /api/agents/1': () => json(makeAgentDetail({ plat: 'windows', hostname: 'ESTACAO-01', version: '3.4.2' })),
      'GET /api/agents/1/peripheral-tests/current': () => {
        if (!current) return new Response(null, { status: 204 });
        // O app respondeu entre uma consulta e outra.
        current = peripheralTest({ status: 'active', username: 'empresa\\maria', connectedAt: new Date().toISOString(), state });
        return json(current);
      },
      'POST /api/agents/1/peripheral-tests': () => {
        current = peripheralTest();
        return json(current, 201);
      },
      'POST /api/agents/1/peripheral-tests/5/end': () => json(peripheralTest({ status: 'ended', endedBy: 'Ana Souza', endedAt: new Date().toISOString(), state })),
    });
    renderApp('/agentes/1');
    const { user, dialog } = await openPeripheralTest();

    expect(await within(dialog).findByText('Nenhum teste de periféricos feito nesta máquina ainda.', {}, SLOW)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Abrir teste no computador' }));
    expect(await within(dialog).findByText('Abrindo o teste no computador ESTACAO-01...', {}, SLOW)).toBeInTheDocument();
    const posted = fetchMock.mock.calls.find(([url, init]) => url === '/api/agents/1/peripheral-tests' && init?.method === 'POST');
    expect(JSON.parse(posted?.[1]?.body as string)).toEqual({ section: 'keyboard' });

    expect(await within(dialog).findByText('Ao vivo', {}, SLOW)).toBeInTheDocument();
    expect(within(dialog).getByText(/Usuário empresa\\maria/)).toBeInTheDocument();
    expect(within(dialog).getByText('Inglês (Estados Unidos)')).toBeInTheDocument();
    expect(within(dialog).getByText('ABNT2 (brasileiro, com a tecla Ç)')).toBeInTheDocument();
    expect(within(dialog).getByText('As teclas não batem com o layout')).toBeInTheDocument();
    expect(within(dialog).getByText('A tecla “ç” escreveu “;” (tecla Semicolon)')).toBeInTheDocument();
    expect(within(dialog).getByTestId('typed-text').textContent).toBe("Ma;'a");
    expect(dialog.querySelector('[data-code="IntlRo"]')).toHaveAttribute('data-tested', 'true');
    expect(dialog.querySelector('[data-code="Semicolon"]')?.textContent).toBe(';');
    expect(within(dialog).getByText('Dispositivo de teclado HID')).toBeInTheDocument();

    // O user-event troca a area de transferencia por uma de teste.
    await user.click(within(dialog).getByRole('button', { name: 'Copiar resumo' }));
    const summary = await navigator.clipboard.readText();
    expect(summary).toContain('Teste de periféricos no computador ESTACAO-01');
    expect(summary).toContain('TECLADO\n- Layout configurado: Inglês (Estados Unidos) (00000409)');

    await user.click(within(dialog).getByRole('button', { name: 'Encerrar teste' }));
    expect(await within(dialog).findByText('Encerrado', {}, SLOW)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Abrir teste no computador' })).toBeInTheDocument();
  });

  it('com o EYES antigo avisa que precisa atualizar e não abre o teste', async () => {
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['agents.view', 'agents.control'] })),
      'GET /api/url-actions': () => json([]),
      'GET /api/agents/1': () => json(makeAgentDetail({ plat: 'windows', hostname: 'ESTACAO-01', version: '3.4.1' })),
      'GET /api/agents/1/peripheral-tests/current': () => new Response(null, { status: 204 }),
    });
    renderApp('/agentes/1');
    const { dialog } = await openPeripheralTest();
    expect(await within(dialog).findByText('Disponível a partir do EYES 3.4.2', {}, SLOW)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Abrir teste no computador' })).toBeNull();
  });

  it('sem agents.control só acompanha', async () => {
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['agents.view'] })),
      'GET /api/url-actions': () => json([]),
      'GET /api/agents/1': () => json(makeAgentDetail({ plat: 'windows', hostname: 'ESTACAO-01' })),
      'GET /api/agents/1/peripheral-tests/current': () => json(peripheralTest({ status: 'ended', endedBy: 'usuário empresa\\maria', state })),
    });
    renderApp('/agentes/1');
    const { dialog } = await openPeripheralTest();
    expect(await within(dialog).findByText('Encerrado', {}, SLOW)).toBeInTheDocument();
    expect(within(dialog).getByText('Inglês (Estados Unidos)')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Abrir teste no computador' })).toBeNull();
  });
});
