import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Ticket } from '../lib/types';
import { TicketList } from './TicketList';

afterEach(cleanup);

const base: Ticket = {
  id: 12,
  title: 'Impressora não imprime',
  status: 'new',
  priority: 'medium',
  createdAt: '2026-10-01T10:00:00Z',
  updatedAt: '2026-10-01T10:00:00Z',
  assignedToName: null,
  chatEnabled: false,
  lastMessageAt: null,
};

describe('TicketList', () => {
  it('mostra número, status, técnico e indicador de mensagem nova', () => {
    const onOpen = vi.fn();
    render(
      <TicketList
        tickets={[base, { ...base, id: 13, title: 'VPN', status: 'waiting_user', assignedToName: 'Ana Souza' }]}
        unread={new Set([13])}
        loading={false}
        error=""
        onOpen={onOpen}
        onNew={vi.fn()}
      />,
    );
    expect(screen.getByText('#12')).toBeTruthy();
    expect(screen.getByText('Novo')).toBeTruthy();
    expect(screen.getByText('Aguardando técnico')).toBeTruthy();
    expect(screen.getByText('Aguardando você')).toBeTruthy();
    expect(screen.getByText('Ana Souza')).toBeTruthy();
    expect(screen.getAllByLabelText('Mensagem nova')).toHaveLength(1);
    fireEvent.click(screen.getByText('VPN'));
    expect(onOpen).toHaveBeenCalledWith(13);
  });

  it('separa chamados em andamento dos encerrados', () => {
    render(
      <TicketList
        tickets={[
          { ...base, id: 20, title: 'Em atendimento', status: 'in_progress', assignedToName: 'Ana Souza' },
          { ...base, id: 21, title: 'Resolvido ontem', status: 'resolved', assignedToName: 'Ana Souza' },
          { ...base, id: 22, title: 'Fechado mês passado', status: 'closed', assignedToName: 'Carlos Lima' },
        ]}
        unread={new Set()}
        loading={false}
        error=""
        onOpen={vi.fn()}
        onNew={vi.fn()}
      />,
    );
    const open = screen.getByRole('region', { name: /Em andamento/ });
    const finished = screen.getByRole('region', { name: /Encerrados/ });
    expect(within(open).getByText('Em atendimento', { selector: '.ticket-title' })).toBeTruthy();
    expect(within(open).getByText('(1)')).toBeTruthy();
    expect(within(finished).getByText('Resolvido ontem')).toBeTruthy();
    expect(within(finished).getByText('Fechado mês passado')).toBeTruthy();
    expect(within(finished).getByText('(2)')).toBeTruthy();
  });

  it('avisa quando não há chamado em andamento, só encerrados', () => {
    render(
      <TicketList
        tickets={[{ ...base, status: 'closed' }]}
        unread={new Set()}
        loading={false}
        error=""
        onOpen={vi.fn()}
        onNew={vi.fn()}
      />,
    );
    expect(screen.getByText('Nenhum chamado em andamento.')).toBeTruthy();
    expect(screen.getByRole('region', { name: /Encerrados/ })).toBeTruthy();
  });

  it('mostra estado vazio com o botão de abrir chamado', () => {
    const onNew = vi.fn();
    render(<TicketList tickets={[]} unread={new Set()} loading={false} error="" onOpen={vi.fn()} onNew={onNew} />);
    expect(screen.getByText(/ainda não abriu nenhum chamado/)).toBeTruthy();
    expect(screen.queryByRole('region', { name: /Em andamento/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir chamado' }));
    expect(onNew).toHaveBeenCalled();
  });
});
