import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FaqDraftDto, FaqEntryDto, FaqOverviewDto, SaveFaqRequest } from '../../api/types';
import { makeTicketDetail, makeTicketMessage } from '../../test/fixtures';
import { json, makeMe, mockFetch, renderApp } from '../../test/utils';
import { helpfulLabel, usageLabel } from './faqFormat';

const ENTRY: FaqEntryDto = {
  id: 7,
  clientId: null,
  clientName: null,
  question: 'A impressora não imprime',
  answer: '1. Desligue a impressora\n2. Ligue de novo',
  category: 'Impressoras',
  tags: ['orientar', 'impressora'],
  enabled: true,
  guides: true,
  status: 'published',
  public: true,
  source: 'team',
  sourceTicketId: null,
  suggestedBy: null,
  views: 12,
  helpfulCount: 4,
  notHelpfulCount: 1,
  usedCount: 3,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  updatedBy: 'Maria Silva',
};

const PROPOSAL: FaqEntryDto = {
  ...ENTRY,
  id: 9,
  question: 'O Outlook pede a senha toda hora',
  answer: '',
  category: null,
  tags: [],
  guides: false,
  status: 'proposed',
  public: false,
  source: 'requester',
  suggestedBy: 'ana em PC-RECEPCAO',
  views: 0,
  helpfulCount: 0,
  notHelpfulCount: 0,
  usedCount: 0,
};

const OVERVIEW: FaqOverviewDto = {
  published: 1,
  proposed: 1,
  uncategorized: 0,
  categories: [{ name: 'Impressoras', count: 1 }],
  allCategories: ['Impressoras'],
  assistant: true,
};

function body(init: RequestInit | undefined): unknown {
  return JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
}

describe('área de FAQ', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('navega pelas categorias, mostra a resposta com as métricas e cria uma entrada publicada', async () => {
    let created: SaveFaqRequest | undefined;
    const queries: URLSearchParams[] = [];
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['docs.view', 'docs.manage'] })),
      'GET /api/clients': () => json([]),
      'GET /api/faq/overview': () => json(OVERVIEW),
      'GET /api/faq': (_init, url) => {
        queries.push(url.searchParams);
        return json(url.searchParams.get('status') === 'proposed' ? [PROPOSAL] : [ENTRY]);
      },
      'POST /api/faq': (init) => {
        created = body(init) as SaveFaqRequest;
        return json({ ...ENTRY, id: 8, ...created }, 201);
      },
    });
    renderApp('/faq');

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /^A impressora não imprime/ }));
    expect(screen.getByText(/1\. Desligue a impressora/)).toBeInTheDocument();
    expect(screen.getByText('12 aberturas no app · usada 3 vezes nos chamados · 80% acharam útil (5 avaliações)')).toBeInTheDocument();
    expect(screen.getByLabelText('Orienta o usuário')).toBeInTheDocument();
    expect(screen.getByLabelText('Visível no app')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Sugestões/ })).toHaveTextContent('1');
    expect(queries.at(-1)?.get('status')).toBe('published');

    const categories = screen.getByRole('navigation', { name: 'Categorias' });
    await user.click(within(categories).getByText('Impressoras'));
    await waitFor(() => expect(queries.at(-1)?.get('category')).toBe('Impressoras'));
    await user.click(screen.getByRole('combobox', { name: 'Filtrar entradas' }));
    await user.click(await screen.findByRole('option', { name: 'Visíveis no app EYES', hidden: true }));
    await waitFor(() => expect(queries.at(-1)?.get('public')).toBe('true'));

    await user.click(screen.getByRole('button', { name: 'Nova entrada' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nova entrada do FAQ' });
    await user.type(within(dialog).getByRole('textbox', { name: /Problema ou pergunta/ }), 'Sem acesso ao e-mail');
    await user.type(within(dialog).getByRole('textbox', { name: /Resposta/ }), '1. Feche o Outlook');
    await user.type(within(dialog).getByRole('combobox', { name: /Categoria/ }), 'E-mail');
    await user.click(within(dialog).getByRole('checkbox', { name: /Orientar/ }));
    await user.click(within(dialog).getByRole('checkbox', { name: /Mostrar na ajuda do app EYES/ }));
    await user.type(within(dialog).getByLabelText(/Outras tags/), 'Outlook{enter}');
    await user.click(within(dialog).getByRole('button', { name: 'Publicar' }));

    await waitFor(() =>
      expect(created).toEqual({
        clientId: null,
        question: 'Sem acesso ao e-mail',
        answer: '1. Feche o Outlook',
        tags: ['orientar', 'outlook'],
        enabled: true,
        category: 'E-mail',
        status: 'published',
        public: true,
        sourceTicketId: null,
      }),
    );
    expect(await screen.findByText('Entrada do FAQ criada.')).toBeInTheDocument();
  });

  it('revisa a pergunta de um usuário do app, pede o rascunho ao assistente e publica', async () => {
    let drafted: unknown;
    let saved: SaveFaqRequest | undefined;
    const draft: FaqDraftDto = {
      action: 'create',
      reason: 'Passos usuais; confira antes de publicar.',
      duplicateOf: 7,
      duplicateQuestion: 'A impressora não imprime',
      question: 'O Outlook pede a senha toda hora',
      answer: '1. Feche o Outlook\n2. Abra o Gerenciador de Credenciais',
      category: 'E-mail',
      tags: ['outlook'],
      guides: true,
      public: true,
      clientSpecific: false,
    };
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['docs.view', 'docs.manage'] })),
      'GET /api/clients': () => json([]),
      'GET /api/faq/overview': () => json(OVERVIEW),
      'GET /api/faq': () => json([PROPOSAL]),
      'POST /api/faq/draft': (init) => {
        drafted = body(init);
        return json(draft);
      },
      'PUT /api/faq/9': (init) => {
        saved = body(init) as SaveFaqRequest;
        return json({ ...PROPOSAL, ...saved });
      },
    });
    renderApp('/faq?aba=sugestoes');

    const card = await screen.findByRole('article', { name: 'O Outlook pede a senha toda hora' });
    expect(within(card).getByText('Usuário do app')).toBeInTheDocument();
    expect(within(card).getByText('Sem resposta ainda.')).toBeInTheDocument();
    expect(within(card).getByText(/Sugerida por ana em PC-RECEPCAO/)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(within(card).getByRole('button', { name: 'Revisar e publicar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Revisar sugestão do FAQ' });
    expect(within(dialog).getByRole('button', { name: 'Publicar' })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Escrever com IA' }));

    await waitFor(() => expect(drafted).toEqual({ question: 'O Outlook pede a senha toda hora', context: null, ticketId: null }));
    expect(await within(dialog).findByText('Passos usuais; confira antes de publicar.')).toBeInTheDocument();
    expect(within(dialog).getByText(/#7 A impressora não imprime/)).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: /Resposta/ })).toHaveValue('1. Feche o Outlook\n2. Abra o Gerenciador de Credenciais');
    expect(within(dialog).getByRole('checkbox', { name: /Orientar/ })).toBeChecked();

    await user.click(within(dialog).getByRole('button', { name: 'Publicar' }));
    await waitFor(() => expect(saved).toMatchObject({ status: 'published', category: 'E-mail', tags: ['orientar', 'outlook'], public: true }));
    expect(await screen.findByText('Entrada do FAQ publicada.')).toBeInTheDocument();
  });

  it('quem só consulta o FAQ envia uma sugestão sem resposta', async () => {
    let created: SaveFaqRequest | undefined;
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['docs.view'] })),
      'GET /api/clients': () => json([]),
      'GET /api/faq/overview': () => json({ ...OVERVIEW, proposed: 0 }),
      'GET /api/faq': () => json([ENTRY]),
      'POST /api/faq': (init) => {
        created = body(init) as SaveFaqRequest;
        return json({ ...PROPOSAL, ...created }, 201);
      },
    });
    renderApp('/faq');

    const user = userEvent.setup();
    expect(await screen.findByRole('button', { name: /^A impressora não imprime/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Editar/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sugerir entrada' }));
    const dialog = await screen.findByRole('dialog', { name: 'Sugerir entrada do FAQ' });
    expect(within(dialog).queryByRole('button', { name: 'Escrever com IA' })).not.toBeInTheDocument();
    await user.type(within(dialog).getByRole('textbox', { name: /Problema ou pergunta/ }), 'Como mapear a pasta da rede?');
    await user.click(within(dialog).getByRole('button', { name: 'Enviar sugestão' }));

    await waitFor(() => expect(created).toMatchObject({ question: 'Como mapear a pasta da rede?', answer: '', status: 'proposed' }));
    expect(await screen.findByText('Sugestão enviada. Ela fica em Sugestões até alguém revisar.')).toBeInTheDocument();
  });

  it('leva a aba antiga da documentação para a área de FAQ', async () => {
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['docs.view'] })),
      'GET /api/clients': () => json([]),
      'GET /api/faq/overview': () => json(OVERVIEW),
      'GET /api/faq': () => json([ENTRY]),
    });
    const { router } = renderApp('/documentacao?aba=faq');
    expect(await screen.findByRole('button', { name: /^A impressora não imprime/ })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/faq');
  });

  it('insere a resposta de uma entrada na resposta do chamado e conta o uso', async () => {
    let used = false;
    const queries: URLSearchParams[] = [];
    mockFetch({
      'GET /api/auth/me': () => json(makeMe({ permissions: ['tickets.view', 'tickets.manage', 'docs.view'] })),
      'GET /api/tickets/summary': () => json({ open: 1, unassigned: 1, mine: 0, breached: 0, byStatus: {} }),
      'GET /api/tickets/101': () => json(makeTicketDetail({ clientId: 4 })),
      'GET /api/tickets/101/messages': () => json([makeTicketMessage()]),
      'GET /api/tickets/101/attachments': () => json([]),
      'GET /api/tickets/101/time': () => json([]),
      'GET /api/tickets/assignees': () => json([{ id: 'u1', name: 'Maria Silva' }]),
      'GET /api/ticket-queues': () => json([{ id: 1, name: 'Geral', description: null, isDefault: true, openCount: 1 }]),
      'GET /api/faq': (_init, url) => {
        queries.push(url.searchParams);
        return json([ENTRY]);
      },
      'POST /api/faq/7/used': () => {
        used = true;
        return new Response(null, { status: 204 });
      },
    });
    renderApp('/chamados/101');

    const user = userEvent.setup();
    const reply = await screen.findByRole('textbox', { name: 'Resposta ao usuário' });
    await user.type(reply, 'Olá!');
    await user.click(screen.getByRole('button', { name: 'Inserir do FAQ' }));
    const dialog = await screen.findByRole('dialog', { name: 'Inserir resposta do FAQ' });
    await user.click(await within(dialog).findByRole('button', { name: 'Inserir A impressora não imprime' }));

    expect(reply).toHaveValue('Olá!\n\n1. Desligue a impressora\n2. Ligue de novo');
    expect(queries[0]?.get('clientId')).toBe('4');
    expect(queries[0]?.get('status')).toBe('published');
    await waitFor(() => expect(used).toBe(true));
  });

  it('descreve o uso e as avaliações', () => {
    expect(helpfulLabel({ helpfulCount: 0, notHelpfulCount: 0 })).toBeNull();
    expect(helpfulLabel({ helpfulCount: 1, notHelpfulCount: 0 })).toBe('100% acharam útil (1 avaliação)');
    expect(usageLabel({ views: 1, usedCount: 1, helpfulCount: 0, notHelpfulCount: 0 })).toBe('1 abertura no app · usada 1 vez nos chamados');
  });
});
