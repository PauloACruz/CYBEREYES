import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackendContext } from '../lib/backend';
import { mockBackend } from '../lib/mockBackend';
import type { Backend } from '../lib/types';
import { HelpPanel } from './HelpPanel';

afterEach(cleanup);

function renderHelp(overrides: Partial<Backend> = {}) {
  const backend: Backend = { ...mockBackend, ...overrides };
  const onOpenTicket = vi.fn();
  render(
    <BackendContext.Provider value={backend}>
      <HelpPanel onOpenTicket={onOpenTicket} />
    </BackendContext.Provider>,
  );
  return { backend, onOpenTicket };
}

describe('HelpPanel', () => {
  it('pesquisa, abre a resposta e oferece abrir chamado quando não resolveu', async () => {
    const listFaq = vi.fn((search: string, category: string) => mockBackend.listFaq(search, category));
    const faqFeedback = vi.fn(() => Promise.resolve());
    const { onOpenTicket } = renderHelp({ listFaq, faqFeedback });

    expect(await screen.findByText('O Wi-Fi cai toda hora')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Impressoras' }));
    await waitFor(() => { expect(listFaq).toHaveBeenLastCalledWith('', 'Impressoras'); });
    await waitFor(() => { expect(screen.queryByText('O Wi-Fi cai toda hora')).toBeNull(); });

    fireEvent.click(screen.getByRole('button', { name: /A impressora não imprime/ }));
    expect(await screen.findByRole('heading', { name: 'A impressora não imprime' })).toBeTruthy();
    expect(screen.getByText(/2\. Desligue e ligue a impressora/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Não' }));
    await screen.findByText(/Abra um chamado e a equipe de suporte ajuda você/);
    expect(faqFeedback).toHaveBeenCalledWith(1, false);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir chamado' }));
    expect(onOpenTicket).toHaveBeenCalledWith({
      title: 'A impressora não imprime',
      description: 'Segui a resposta "A impressora não imprime" da Ajuda e o problema continua.',
    });
  });

  it('agradece quando a resposta resolveu', async () => {
    const faqFeedback = vi.fn(() => Promise.resolve());
    renderHelp({ faqFeedback });
    fireEvent.click(await screen.findByRole('button', { name: /O Wi-Fi cai toda hora/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sim, resolveu' }));
    expect(await screen.findByText('Que bom! Obrigado por avisar.')).toBeTruthy();
    expect(faqFeedback).toHaveBeenCalledWith(2, true);
  });

  it('envia a pergunta digitada na busca quando não encontra a resposta', async () => {
    const suggestFaq = vi.fn(() => Promise.resolve());
    renderHelp({ suggestFaq });
    fireEvent.change(await screen.findByRole('searchbox', { name: 'Buscar na ajuda' }), { target: { value: 'papel de parede' } });
    expect(await screen.findByText('Nenhuma resposta encontrada.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Enviar uma pergunta' }));
    const field = screen.getByRole('textbox', { name: 'Sua pergunta' });
    expect((field as HTMLInputElement).value).toBe('papel de parede');
    fireEvent.change(field, { target: { value: 'Como trocar o papel de parede?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar pergunta' }));
    expect(await screen.findByText(/Pergunta enviada/)).toBeTruthy();
    expect(suggestFaq).toHaveBeenCalledWith('Como trocar o papel de parede?');
  });

  it('mostra o erro do limite de perguntas', async () => {
    const limit = 'Você já enviou várias perguntas agora há pouco. Tente de novo mais tarde.';
    renderHelp({ suggestFaq: () => Promise.reject(new Error(limit)) });
    fireEvent.click(await screen.findByRole('button', { name: 'Enviar uma pergunta' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Sua pergunta' }), { target: { value: 'Outra pergunta' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar pergunta' }));
    expect((await screen.findByRole('alert')).textContent).toBe(limit);
  });
});
