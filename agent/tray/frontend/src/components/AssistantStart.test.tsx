import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { deriveTitle } from '../lib/assistant';
import type { Message } from '../lib/types';
import { AssistantStart } from './AssistantStart';
import { ChatThread } from './ChatThread';

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe('AssistantStart', () => {
  it('cumprimenta, pede a descrição e abre o chamado com o título tirado da mensagem', async () => {
    const onSubmit = vi.fn(() => Promise.resolve());
    render(<AssistantStart assistantName="Assistente Cybereyes" username="maria" onSubmit={onSubmit} onCancel={vi.fn()} />);
    expect(screen.getByText(/Olá, maria! Sou o Assistente Cybereyes/)).toBeTruthy();

    const send = screen.getByRole<HTMLButtonElement>('button', { name: 'Enviar' });
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: 'Descreva o problema' }), {
      target: { value: '  A impressora não imprime\ndesde ontem, aparece erro na fila  ' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Anexar captura da tela' }));
    fireEvent.click(send);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        'A impressora não imprime desde ontem, aparece erro na fila',
        'A impressora não imprime\ndesde ontem, aparece erro na fila',
        false,
      );
    });
  });

  it('mostra o erro e deixa tentar de novo', async () => {
    const onSubmit = vi.fn(() => Promise.reject(new Error('Serviço EYES indisponível')));
    render(<AssistantStart assistantName="Assistente" username="" onSubmit={onSubmit} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Descreva o problema' }), { target: { value: 'Sem internet' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Serviço EYES indisponível');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Enviar' }).disabled).toBe(false);
  });
});

describe('deriveTitle', () => {
  it('junta as linhas e corta em 80 caracteres', () => {
    expect(deriveTitle('  Sem\n\nrede ')).toBe('Sem rede');
    const long = deriveTitle('a'.repeat(120));
    expect(long).toHaveLength(80);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('mensagens do assistente', () => {
  it('aparecem do lado da equipe com o nome do assistente', () => {
    const messages: Message[] = [
      { id: 1, authorType: 'assistant', authorName: 'Assistente Cybereyes', body: '1. Reinicie', createdAt: '2026-10-01T10:00:00Z', attachments: [] },
    ];
    render(<ChatThread ticketId={1} messages={messages} />);
    const item = screen.getAllByRole('listitem').find((li) => li.dataset.author === 'assistant');
    expect(item?.className).toBe('msg msg-assistant');
    expect(screen.getByText('Assistente Cybereyes')).toBeTruthy();
  });
});
