import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { notifications } from '@mantine/notifications';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssistantAgentDto, AssistantSettingsDto, SaveAssistantSettingsRequest } from '../../api/types';
import { json, makeMe, mockFetch, problem, renderApp } from '../../test/utils';

function makeSettings(overrides: Partial<AssistantSettingsDto> = {}): AssistantSettingsDto {
  return {
    keySet: false,
    keyHint: null,
    model: 'claude-opus-5-5',
    name: 'Assistente Cybereyes',
    agentId: null,
    agentEnabled: true,
    nativeEnabled: true,
    instructions: null,
    chatEffort: 'low',
    logEffort: 'medium',
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    chatEnabled: false,
    faqLearn: true,
    logInsightsEnabled: false,
    logInsightsIntervalHours: 24,
    logInsightsMinLevel: 'error',
    logInsightsPush: true,
    logInsightsEmail: false,
    logInsightsLastRunAt: null,
    smtpConfigured: false,
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
    ...overrides,
  };
}

const BASE = {
  'GET /api/auth/me': () => json(makeMe({ permissions: ['settings.manage'] })),
  'GET /api/remote/policies': () => json([]),
  'GET /api/clients': () => json([]),
  'GET /api/sso/providers': () => json([]),
  'GET /api/sso/settings': () => json({ disablePasswordLogin: false }),
  'GET /api/assistant/agents': () => json([]),
};

const AGENT: AssistantAgentDto = { id: 'agent_01', name: 'Suporte N1', description: 'Tom da empresa', model: 'claude-sonnet-5-5', version: 3 };

function body(init: RequestInit | undefined): unknown {
  return JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
}

describe('assistente de IA nas configurações', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    // Os avisos do Mantine ficam num estado global; o limite da fila esconderia os do proximo teste.
    notifications.clean();
  });

  it('cadastra a chave, liga o atendimento e a análise e não reenvia a chave depois', async () => {
    const saved: SaveAssistantSettingsRequest[] = [];
    let tested: { apiKey: string | null; model: string; agentId: string | null } | undefined;
    mockFetch({
      ...BASE,
      'GET /api/assistant/settings': () => json(makeSettings()),
      'POST /api/assistant/test': (init) => {
        tested = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as typeof tested;
        return json({ success: true, message: 'Chave válida: o modelo claude-opus-5-5 está disponível.' });
      },
      'PUT /api/assistant/settings': (init) => {
        const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as SaveAssistantSettingsRequest;
        saved.push(body);
        return json(makeSettings({ ...body, keySet: true, keyHint: '1234' }));
      },
    });
    renderApp('/configuracoes');

    const section = await screen.findByRole('region', { name: 'Assistente de IA' });
    const user = userEvent.setup();
    const save = await within(section).findByRole('button', { name: 'Salvar' });

    await user.click(within(section).getByRole('switch', { name: /primeiro atendimento/ }));
    expect(save).toBeDisabled();
    expect(within(section).getByText('Cadastre a chave da API para ligar o assistente.')).toBeInTheDocument();

    const key = within(section).getByLabelText(/Chave da API da Anthropic/);
    await user.type(key, 'chave-errada');
    expect(within(section).getByText('A chave da Anthropic começa com sk-ant-')).toBeInTheDocument();
    await user.clear(key);
    await user.paste('sk-ant-api03-chave-de-teste-1234');

    await user.click(within(section).getByRole('button', { name: 'Testar conexão' }));
    await waitFor(() => expect(tested).toEqual({ apiKey: 'sk-ant-api03-chave-de-teste-1234', model: 'claude-opus-5-5', agentId: null }));
    expect(await screen.findByText('Chave válida: o modelo claude-opus-5-5 está disponível.')).toBeInTheDocument();

    await user.click(within(section).getByRole('switch', { name: /Analisar periodicamente/ }));
    expect(within(section).getByRole('checkbox', { name: 'Enviar também por e-mail' })).toBeDisabled();
    await user.click(save);

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toMatchObject({
      apiKey: 'sk-ant-api03-chave-de-teste-1234',
      chatEnabled: true,
      faqLearn: true,
      logInsightsEnabled: true,
      logInsightsIntervalHours: 24,
      model: 'claude-opus-5-5',
      agentId: null,
      chatEffort: 'low',
      logEffort: 'medium',
    });
    expect(await screen.findByText('Configuração do assistente salva.')).toBeInTheDocument();

    // Depois de salva, o campo volta vazio e salvar de novo mantem a chave gravada (apiKey nulo).
    expect(await within(section).findByPlaceholderText('Chave gravada terminando em 1234')).toHaveValue('');
    await user.click(within(section).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(saved).toHaveLength(2));
    expect(saved[1]?.apiKey).toBeNull();
  });

  it('escreve as instruções do agente nativo e liga e desliga cada agente', async () => {
    const saved: SaveAssistantSettingsRequest[] = [];
    mockFetch({
      ...BASE,
      'GET /api/assistant/settings': () =>
        json(makeSettings({ keySet: true, keyHint: '1234', chatEnabled: true, agentId: 'agent_01', model: 'agent', instructions: 'Assine como Suporte ACME.' })),
      'GET /api/assistant/agents': () => json([AGENT]),
      'PUT /api/assistant/settings': (init) => {
        const request = body(init) as SaveAssistantSettingsRequest;
        saved.push(request);
        return json(makeSettings({ ...request, keySet: true, keyHint: '1234' }));
      },
    });
    renderApp('/configuracoes');

    const section = await screen.findByRole('region', { name: 'Assistente de IA' });
    const user = userEvent.setup();
    const instructions = await within(section).findByRole('textbox', { name: 'Instruções do agente nativo' });
    expect(instructions).toHaveValue('Assine como Suporte ACME.');
    await user.type(instructions, ' Atendemos das 8h às 18h.');

    // Desligar o agente da Anthropic tira o modelo dele e desabilita a escolha do agente.
    await user.click(within(section).getByRole('switch', { name: /Agente da Anthropic/ }));
    expect(within(section).getByRole('combobox', { name: /^Modelo/ })).toHaveValue('Claude Opus 5.5 (recomendado)');
    expect(within(section).getByRole('combobox', { name: /Agente vinculado/ })).toBeDisabled();

    // Sem nenhum agente o assistente ligado não salva.
    await user.click(within(section).getByRole('switch', { name: /Agente nativo/ }));
    expect(instructions).toBeDisabled();
    expect(within(section).getByText(/Ative o agente nativo ou o agente da Anthropic/)).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: 'Salvar' })).toBeDisabled();

    await user.click(within(section).getByRole('switch', { name: /Agente nativo/ }));
    await user.click(within(section).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toMatchObject({
      nativeEnabled: true,
      agentEnabled: false,
      agentId: 'agent_01',
      model: 'claude-opus-5-5',
      instructions: 'Assine como Suporte ACME. Atendemos das 8h às 18h.',
    });
  });

  it('mostra o erro da Anthropic ao testar uma chave recusada', async () => {
    mockFetch({
      ...BASE,
      'GET /api/assistant/settings': () => json(makeSettings({ keySet: true, keyHint: 'abcd' })),
      'POST /api/assistant/test': () => problem(400, 'VALIDATION', 'A Anthropic recusou a chave da API'),
    });
    renderApp('/configuracoes');

    const section = await screen.findByRole('region', { name: 'Assistente de IA' });
    await userEvent.setup().click(await within(section).findByRole('button', { name: 'Testar conexão' }));
    expect(await screen.findByText('A Anthropic recusou a chave da API')).toBeInTheDocument();
  });

  it('vincula um agente da conta, usa o modelo dele e escolhe o esforço do chat e da análise', async () => {
    const agents = [AGENT];
    const saved: SaveAssistantSettingsRequest[] = [];
    let created: { name: string; model: string | null } | undefined;
    mockFetch({
      ...BASE,
      'GET /api/assistant/settings': () => json(makeSettings({ keySet: true, keyHint: '1234', model: 'claude-haiku-5-5' })),
      'GET /api/assistant/agents': () => json(agents),
      'POST /api/assistant/agents': (init) => {
        created = body(init) as typeof created;
        const agent: AssistantAgentDto = { id: 'agent_02', name: created?.name ?? '', description: null, model: 'claude-haiku-5-5', version: 1 };
        agents.push(agent);
        return json(agent, 201);
      },
      'PUT /api/assistant/settings': (init) => {
        const request = body(init) as SaveAssistantSettingsRequest;
        saved.push(request);
        return json(makeSettings({ ...request, keySet: true, keyHint: '1234' }));
      },
    });
    renderApp('/configuracoes');

    const section = await screen.findByRole('region', { name: 'Assistente de IA' });
    const user = userEvent.setup();
    // Cada Select tem a sua lista; procura a opcao so na lista do campo aberto.
    const pick = async (label: RegExp, option: string) => {
      const box = await within(section).findByRole('combobox', { name: label });
      await user.click(box);
      await waitFor(() => expect(document.getElementById(box.getAttribute('aria-controls') ?? '')).not.toBeNull());
      const list = document.getElementById(box.getAttribute('aria-controls') ?? '') as HTMLElement;
      await user.click(await within(list).findByRole('option', { name: option, hidden: true }));
    };

    await pick(/Agente vinculado/, 'Suporte N1 · claude-sonnet-5-5 · v3');
    expect(within(section).getByText('Tom da empresa')).toBeInTheDocument();
    await pick(/^Modelo/, 'Modelo do agente (claude-sonnet-5-5)');
    await pick(/esforço no chat/, 'Alto');
    await pick(/esforço na análise de logs/, 'Máximo: mais lento e caro');
    await user.click(within(section).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toMatchObject({ agentId: 'agent_01', model: 'agent', chatEffort: 'high', logEffort: 'max' });

    // Criar um agente novo na conta ja o deixa escolhido.
    await user.click(await within(section).findByRole('button', { name: 'Criar agente na Anthropic' }));
    await waitFor(() => expect(created).toEqual({ name: 'Assistente Cybereyes', model: null }));
    expect(await within(section).findByDisplayValue('Assistente Cybereyes · claude-haiku-5-5 · v1')).toBeInTheDocument();

    // Sem agente, a opção de usar o modelo dele some e o modelo volta para um fixo.
    // Escolher de novo a opcao marcada desvincula o agente.
    await pick(/Agente vinculado/, 'Assistente Cybereyes · claude-haiku-5-5 · v1');
    await user.click(within(section).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(saved).toHaveLength(2));
    expect(saved[1]).toMatchObject({ agentId: null, model: 'claude-opus-5-5' });
  });
});
