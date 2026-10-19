import type {
  Backend,
  FaqEntry,
  Message,
  RemoteEvent,
  RunStatus,
  SelfServiceEvent,
  SelfServiceRun,
  SelfServiceTask,
  Ticket,
  TicketDetail,
  TicketMessageEvent,
} from './types';

// Simulador usado com "npm run dev:mock" para desenvolver e validar a interface fora do Wails.
type Listener<T> = (data: T) => void;

const now = () => new Date().toISOString();
const msgListeners = new Set<Listener<TicketMessageEvent>>();
const changeListeners = new Set<Listener<Ticket>>();
const selfServiceListeners = new Set<Listener<SelfServiceEvent>>();

const selfServiceTasks: SelfServiceTask[] = [
  { module: 'cleanup', key: 'temp', label: 'Limpar arquivos temporários', description: 'Apaga arquivos temporários e libera espaço em disco.' },
  { module: 'network', key: 'reset', label: 'Corrigir conexão de rede', description: 'Renova o endereço IP e limpa o cache de DNS.' },
  { module: 'printer', key: 'spooler', label: 'Reiniciar fila de impressão', description: 'Reinicia o serviço de impressão e limpa documentos travados.' },
];
const selfServiceRuns = new Map<string, SelfServiceRun>();
let selfServiceBusy = false;

// Simula uma execucao: a rede termina com erro para exibir o botao "Abrir chamado".
function simulateRun(run: SelfServiceRun, final: RunStatus) {
  const steps = ['Preparando', 'Executando a ação', 'Conferindo o resultado', 'Finalizando'];
  let i = 0;
  const timer = setInterval(() => {
    i++;
    const done = i > steps.length;
    run.progress = done ? 100 : i * 22;
    run.status = done ? final : 'running';
    const message = done ? (final === 'ok' ? 'Tudo certo.' : 'Não foi possível concluir a ação.') : (steps[i - 1] ?? '');
    run.messages.push(message);
    selfServiceListeners.forEach((l) => { l({ runId: run.runId, status: run.status, progress: run.progress, message }); });
    if (done) {
      selfServiceBusy = false;
      clearInterval(timer);
    }
  }, 900);
}

let nextMessageId = 100;
const tickets: TicketDetail[] = [
  {
    id: 41,
    title: 'Impressora do financeiro não imprime',
    status: 'in_progress',
    priority: 'medium',
    createdAt: '2026-09-30T13:10:00Z',
    updatedAt: '2026-09-30T14:00:00Z',
    assignedToName: 'Ana Souza',
    chatEnabled: true,
    lastMessageAt: '2026-09-30T14:00:00Z',
    description: 'Quando mando imprimir aparece "erro de spool".',
    attachments: [],
    messages: [
      { id: 1, authorType: 'system', authorName: 'Sistema', body: 'Admin atribuiu o chamado a Ana Souza', createdAt: '2026-09-30T13:30:00Z', attachments: [] },
      { id: 2, authorType: 'technician', authorName: 'Ana Souza', body: 'Olá! Pode reiniciar a impressora e me dizer se o erro continua?', createdAt: '2026-09-30T13:40:00Z', attachments: [] },
      { id: 3, authorType: 'requester', authorName: 'maria', body: 'Reiniciei e continua igual.', createdAt: '2026-09-30T14:00:00Z', attachments: [] },
    ],
  },
  {
    id: 38,
    title: 'Instalar o leitor de PDF',
    status: 'resolved',
    priority: 'low',
    createdAt: '2026-09-20T10:00:00Z',
    updatedAt: '2026-09-21T09:00:00Z',
    assignedToName: 'Carlos Lima',
    chatEnabled: true,
    lastMessageAt: '2026-09-21T09:00:00Z',
    description: '',
    attachments: [],
    messages: [],
  },
  {
    id: 40,
    title: 'Sem acesso à pasta do RH',
    status: 'waiting_user',
    priority: 'medium',
    createdAt: '2026-09-29T09:00:00Z',
    updatedAt: '2026-09-29T11:00:00Z',
    assignedToName: 'Carlos Lima',
    chatEnabled: true,
    lastMessageAt: '2026-09-29T11:00:00Z',
    description: 'Aparece "acesso negado" ao abrir a pasta.',
    attachments: [],
    messages: [
      { id: 4, authorType: 'technician', authorName: 'Carlos Lima', body: 'Qual é o caminho exato da pasta?', createdAt: '2026-09-29T11:00:00Z', attachments: [] },
      { id: 5, authorType: 'system', authorName: 'Sistema', body: 'Carlos Lima alterou o status para Aguardando usuario', createdAt: '2026-09-29T11:00:01Z', attachments: [] },
    ],
  },
  {
    id: 35,
    title: 'Trocar o mouse',
    status: 'closed',
    priority: 'low',
    createdAt: '2026-09-10T08:00:00Z',
    updatedAt: '2026-09-11T08:00:00Z',
    assignedToName: 'Ana Souza',
    chatEnabled: false,
    lastMessageAt: null,
    description: '',
    attachments: [],
    messages: [],
  },
];

function summary(t: TicketDetail): Ticket {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    assignedToName: t.assignedToName,
    chatEnabled: t.chatEnabled,
    lastMessageAt: t.lastMessageAt,
  };
}

function find(id: number): TicketDetail {
  const t = tickets.find((x) => x.id === id);
  if (!t) throw new Error('Chamado não encontrado.');
  return t;
}

function push(t: TicketDetail, m: Message) {
  t.messages.push(m);
  t.lastMessageAt = m.createdAt;
  msgListeners.forEach((l) => { l({ ticketId: t.id, message: m }); });
}

const remoteListeners = new Set<(e: RemoteEvent) => void>();

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Imagem 1x1 cinza usada como captura simulada.
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8+P9/PQAJYwPBpqbiOAAAAABJRU5ErkJggg==';

const faq: FaqEntry[] = [
  {
    id: 1,
    question: 'A impressora não imprime',
    answer: '1. Confira se a impressora está ligada e com papel.\n2. Desligue e ligue a impressora.\n3. Imprima uma página de teste.\n4. Se não resolver, abra um chamado.',
    category: 'Impressoras',
    updatedAt: '2026-10-18T14:00:00Z',
  },
  {
    id: 2,
    question: 'O Wi-Fi cai toda hora',
    answer: '1. Desligue e ligue o Wi-Fi do computador.\n2. Aproxime-se do roteador.\n3. Se não resolver, abra um chamado.',
    category: 'Rede e internet',
    updatedAt: '2026-10-17T09:30:00Z',
  },
  {
    id: 3,
    question: 'Esqueci a senha do e-mail',
    answer: '1. Abra o portal de senhas da empresa.\n2. Clique em Esqueci a senha e siga as instruções.',
    category: 'Acesso e senhas',
    updatedAt: '2026-10-16T11:00:00Z',
  },
];

export const mockBackend: Backend = {
  async session() {
    await delay(150);
    return {
      hostname: 'PC-FINANCEIRO-01', username: 'maria', clientName: 'Contoso', siteName: 'Matriz', connected: true, realtime: true,
      assistantEnabled: true, assistantName: 'Assistente Cybereyes', faqEnabled: true,
    };
  },
  async listTickets() {
    await delay(150);
    return tickets.map(summary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  async getTicket(id) {
    await delay(100);
    const t = find(id);
    return { ...t, messages: [...t.messages], attachments: [...t.attachments] };
  },
  async createTicket(title, description, includeScreenshot) {
    await delay(600);
    const t: TicketDetail = {
      id: Math.max(...tickets.map((x) => x.id)) + 1,
      title,
      description,
      status: 'new',
      priority: 'medium',
      createdAt: now(),
      updatedAt: now(),
      assignedToName: null,
      // Com o assistente, o chat abre junto com o chamado.
      chatEnabled: true,
      lastMessageAt: null,
      messages: [],
      attachments: includeScreenshot ? [{ id: 900, fileName: 'captura.png', contentType: 'image/png', size: 68 }] : [],
    };
    tickets.push(t);
    // Simula o assistente respondendo com o passo a passo do FAQ e, depois, um tecnico assumindo.
    setTimeout(() => {
      push(t, {
        id: nextMessageId++, authorType: 'assistant', authorName: 'Assistente Cybereyes', createdAt: now(), attachments: [],
        body: 'Olá, maria! Esse problema costuma ter solução rápida.\n\n1. Desligue a impressora\n2. Ligue de novo\n3. Imprima uma página de teste\n\nDepois de seguir os passos, me conte aqui se o problema foi resolvido.',
      });
    }, 1200);
    setTimeout(() => {
      t.assignedToName = 'Ana Souza';
      t.status = 'in_progress';
      t.chatEnabled = true;
      push(t, { id: nextMessageId++, authorType: 'system', authorName: 'Sistema', body: 'Admin atribuiu o chamado a Ana Souza', createdAt: now(), attachments: [] });
      changeListeners.forEach((l) => { l(summary(t)); });
      push(t, { id: nextMessageId++, authorType: 'technician', authorName: 'Ana Souza', body: 'Olá! Já estou olhando o seu chamado.', createdAt: now(), attachments: [] });
    }, 8000);
    return { ticket: summary(t), screenshotAttached: includeScreenshot };
  },
  async sendMessage(ticketId, body) {
    await delay(150);
    const t = find(ticketId);
    if (!t.chatEnabled) throw new Error('O chat será liberado quando um técnico assumir o seu chamado.');
    const m: Message = { id: nextMessageId++, authorType: 'requester', authorName: 'maria', body, createdAt: now(), attachments: [] };
    push(t, m);
    return m;
  },
  attachment() {
    return Promise.resolve(PIXEL);
  },
  onTicketMessage(cb) {
    msgListeners.add(cb);
    return () => { msgListeners.delete(cb); };
  },
  onTicketChanged(cb) {
    changeListeners.add(cb);
    return () => { changeListeners.delete(cb); };
  },
  onConnection() {
    return () => undefined;
  },
  onNavigate() {
    return () => undefined;
  },
  onRefresh() {
    return () => undefined;
  },
  async selfServiceOptions() {
    await delay(150);
    return { enabled: true, tasks: [...selfServiceTasks] };
  },
  async runSelfService(module, key) {
    await delay(300);
    const task = selfServiceTasks.find((t) => t.module === module && t.key === key);
    if (!task) throw new Error('Esta ação não está liberada pelo suporte.');
    if (selfServiceBusy || module === 'printer') {
      throw new Error('Já existe uma manutenção em andamento neste computador. Tente novamente em alguns minutos.');
    }
    selfServiceBusy = true;
    const run: SelfServiceRun = { runId: `run-${String(Date.now())}`, status: 'running', progress: 0, label: `${module}.${key}`, messages: [] };
    selfServiceRuns.set(run.runId, run);
    simulateRun(run, module === 'network' ? 'error' : 'ok');
    return { runId: run.runId };
  },
  async selfServiceRun(runId) {
    await delay(100);
    const run = selfServiceRuns.get(runId);
    if (!run) throw new Error('Execução não encontrada.');
    return { ...run, messages: [...run.messages] };
  },
  onSelfService(cb) {
    selfServiceListeners.add(cb);
    return () => { selfServiceListeners.delete(cb); };
  },
  // No modo de demonstracao, um pedido de acesso aparece alguns segundos depois de abrir.
  onRemote(cb) {
    const timer = setTimeout(() => { cb({ event: 'remote-ask', session: 'demo', technician: 'Carlos (Suporte)', timeout: 60 }); }, 3000);
    remoteListeners.add(cb);
    return () => {
      clearTimeout(timer);
      remoteListeners.delete(cb);
    };
  },
  async remoteAnswer(session, accept) {
    await delay(100);
    for (const cb of remoteListeners) cb({ event: accept ? 'remote-notify' : 'remote-ended', session, technician: 'Carlos (Suporte)' });
  },
  async remoteEnd(session) {
    await delay(100);
    for (const cb of remoteListeners) cb({ event: 'remote-ended', session });
  },
  async listFaq(search, category) {
    await delay(150);
    const term = search.trim().toLowerCase();
    const entries = faq
      .filter((f) => !category || f.category === category)
      .filter((f) => !term || f.question.toLowerCase().includes(term) || f.answer.toLowerCase().includes(term))
      .map((f) => ({ id: f.id, question: f.question, category: f.category, excerpt: f.answer.replace(/\s+/g, ' ').slice(0, 160) }));
    return { categories: [...new Set(faq.map((f) => f.category ?? ''))].filter(Boolean).sort(), entries };
  },
  async getFaq(id) {
    await delay(100);
    const entry = faq.find((f) => f.id === id);
    if (!entry) throw new Error('Esta pergunta não está mais disponível.');
    return { ...entry };
  },
  async faqFeedback() {
    await delay(100);
  },
  async suggestFaq(question) {
    await delay(300);
    if (question.trim().length < 3) throw new Error('Escreva a sua pergunta.');
  },
};
