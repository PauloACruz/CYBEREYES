import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PERMISSIONS, type SaveTicketRotationRequest, type TicketRotationDto } from '../../api/types';
import { json, makeMe, mockFetch, renderApp } from '../../test/utils';

const ROTATION: TicketRotationDto = {
  enabled: true,
  nextUserId: 'u-bruno',
  members: [
    { userId: 'u-ana', name: 'Ana Lima', active: true, queueIds: [], lastAssignedAt: '2026-10-19T12:00:00Z', openTickets: 3 },
    { userId: 'u-bruno', name: 'Bruno Reis', active: true, queueIds: [2], lastAssignedAt: null, openTickets: 0 },
  ],
  candidates: [{ id: 'u-carla', name: 'Carla Dias' }],
  queues: [
    { id: '1', name: 'Suporte' },
    { id: '2', name: 'Redes' },
  ],
};

describe('fila de atendimento em Usuários', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('mostra quem é o próximo e salva ordem, pausa, filas e técnico novo', async () => {
    let sent: SaveTicketRotationRequest | undefined;
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: [PERMISSIONS.usersView, PERMISSIONS.usersManage] })),
      'GET /api/users': () => json({ items: [], total: 0, page: 1, pageSize: 25 }),
      'GET /api/ticket-rotation': () => json(ROTATION),
      'PUT /api/ticket-rotation': (init) => {
        sent = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as SaveTicketRotationRequest;
        return json({ ...ROTATION, members: [] });
      },
    });
    renderApp('/usuarios?aba=fila');

    const table = await screen.findByRole('table', { name: 'Fila de atendimento' });
    const bruno = within(table).getByText('Bruno Reis').closest('tr') as HTMLElement;
    expect(within(bruno).getByText('Próximo')).toBeInTheDocument();
    expect(within(table).getByText('Nunca')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar fila' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Novo usuário' })).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Subir Bruno Reis' }));
    await user.click(screen.getByRole('switch', { name: 'Ana Lima na fila' }));
    await user.click(screen.getByRole('combobox', { name: 'Adicionar técnico à fila' }));
    await user.click(await screen.findByRole('option', { name: 'Carla Dias', hidden: true }));
    await user.click(screen.getByRole('button', { name: 'Salvar fila' }));

    await waitFor(() =>
      expect(sent).toEqual({
        enabled: true,
        members: [
          { userId: 'u-bruno', active: true, queueIds: [2] },
          { userId: 'u-ana', active: false, queueIds: [] },
          { userId: 'u-carla', active: true, queueIds: [] },
        ],
      }),
    );
  });

  it('quem só vê usuários não altera a fila', async () => {
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: [PERMISSIONS.usersView] })),
      'GET /api/users': () => json({ items: [], total: 0, page: 1, pageSize: 25 }),
      'GET /api/ticket-rotation': () => json(ROTATION),
    });
    renderApp('/usuarios?aba=fila');

    expect(await screen.findByRole('table', { name: 'Fila de atendimento' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Ana Lima na fila' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Salvar fila' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tirar Ana Lima da fila' })).not.toBeInTheDocument();
  });
});
