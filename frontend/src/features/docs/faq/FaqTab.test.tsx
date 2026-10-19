import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FaqEntryDto, SaveFaqRequest } from '../../../api/types';
import { json, makeMe, mockFetch, renderApp } from '../../../test/utils';

const ENTRY: FaqEntryDto = {
  id: 7,
  clientId: null,
  clientName: null,
  question: 'A impressora não imprime',
  answer: '1. Desligue a impressora\n2. Ligue de novo',
  tags: ['orientar', 'impressora'],
  enabled: true,
  guides: true,
  updatedAt: new Date().toISOString(),
  updatedBy: 'Maria Silva',
};

describe('FAQ na documentação', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lista as entradas, destaca a tag orientar e cria uma entrada que orienta o usuário', async () => {
    let created: SaveFaqRequest | undefined;
    const queries: URLSearchParams[] = [];
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['docs.view', 'docs.manage'] })),
      'GET /api/clients': () => json([]),
      'GET /api/faq': (_init, url) => {
        queries.push(url.searchParams);
        return json([ENTRY]);
      },
      'POST /api/faq': (init) => {
        created = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as SaveFaqRequest;
        return json({ ...ENTRY, id: 8, ...created }, 201);
      },
    });
    renderApp('/documentacao?aba=faq');

    expect(await screen.findByText('A impressora não imprime')).toBeInTheDocument();
    expect(screen.getByLabelText('Orienta o usuário')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Filtrar entradas' }));
    await user.click(await screen.findByRole('option', { name: 'Com a tag orientar', hidden: true }));
    await waitFor(() => expect(queries.at(-1)?.get('tag')).toBe('orientar'));

    await user.click(screen.getByRole('button', { name: 'Nova entrada' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nova entrada do FAQ' });
    await user.type(within(dialog).getByRole('textbox', { name: /Problema ou pergunta/ }), 'Sem acesso ao e-mail');
    await user.type(within(dialog).getByRole('textbox', { name: /Resposta/ }), '1. Feche o Outlook');
    await user.click(within(dialog).getByRole('checkbox', { name: /Orientar/ }));
    await user.type(within(dialog).getByLabelText(/Outras tags/), 'E-mail{enter}');
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    await waitFor(() =>
      expect(created).toEqual({ clientId: null, question: 'Sem acesso ao e-mail', answer: '1. Feche o Outlook', tags: ['orientar', 'e-mail'], enabled: true }),
    );
    expect(await screen.findByText('Entrada do FAQ criada.')).toBeInTheDocument();
  });
});
