import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ticketProgress } from '../lib/progress';
import type { TicketStatus } from '../lib/types';
import { CHAT_CLOSED_TEXT, CHAT_LOCKED_TEXT, Composer } from './Composer';
import { TicketProgress } from './TicketProgress';

afterEach(cleanup);

const opened = '2026-10-01T10:00:00Z';

function states(status: TicketStatus, assignedToName: string | null = 'Ana Souza') {
  return ticketProgress({ status, assignedToName, createdAt: opened }).map((s) => s.state);
}

describe('andamento do chamado', () => {
  it('marca a etapa atual conforme o status', () => {
    expect(states('new', null)).toEqual(['done', 'current', 'pending']);
    expect(states('in_progress')).toEqual(['done', 'current', 'pending']);
    expect(states('waiting_user')).toEqual(['done', 'attention', 'pending']);
    expect(states('resolved')).toEqual(['done', 'done', 'done']);
    expect(states('closed')).toEqual(['done', 'done', 'done']);
  });

  it('chamado novo sem técnico mostra que aguarda atendimento', () => {
    render(<TicketProgress ticket={{ status: 'new', assignedToName: null, createdAt: opened }} />);
    const current = screen.getByRole('listitem', { current: 'step' });
    expect(current.textContent).toContain('Em atendimento');
    expect(current.textContent).toContain('Aguardando um técnico');
    expect(current.textContent).toContain('(etapa atual)');
  });

  it('mostra o técnico e destaca quando aguarda a resposta do usuário', () => {
    const { rerender } = render(<TicketProgress ticket={{ status: 'in_progress', assignedToName: 'Ana Souza', createdAt: opened }} />);
    expect(screen.getByRole('listitem', { current: 'step' }).textContent).toContain('Ana Souza');

    rerender(<TicketProgress ticket={{ status: 'waiting_user', assignedToName: 'Ana Souza', createdAt: opened }} />);
    const current = screen.getByRole('listitem', { current: 'step' });
    expect(current.className).toContain('progress-attention');
    expect(current.textContent).toContain('Aguardando sua resposta');
  });

  it('chamado fechado termina em "Encerrado"; resolvido convida a responder se voltar', () => {
    const { rerender } = render(<TicketProgress ticket={{ status: 'closed', assignedToName: 'Ana Souza', createdAt: opened }} />);
    expect(screen.getByRole('listitem', { current: 'step' }).textContent).toContain('Encerrado');

    rerender(<TicketProgress ticket={{ status: 'resolved', assignedToName: 'Ana Souza', createdAt: opened }} />);
    const current = screen.getByRole('listitem', { current: 'step' });
    expect(current.textContent).toContain('Resolvido');
    expect(current.textContent).toContain('Responda se o problema voltar');
  });

  it('chat bloqueado explica o motivo: sem técnico ou chamado encerrado', () => {
    const { rerender } = render(<Composer enabled={false} onSend={vi.fn()} />);
    expect(screen.getByText(CHAT_LOCKED_TEXT)).toBeTruthy();
    rerender(<Composer enabled={false} onSend={vi.fn()} lockedText={CHAT_CLOSED_TEXT} />);
    expect(screen.getByText(CHAT_CLOSED_TEXT)).toBeTruthy();
    rerender(<Composer enabled onSend={vi.fn()} placeholder="O técnico aguarda sua resposta" />);
    expect(screen.getByPlaceholderText('O técnico aguarda sua resposta')).toBeTruthy();
  });
});
