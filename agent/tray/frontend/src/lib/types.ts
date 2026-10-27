export type TicketStatus = 'new' | 'in_progress' | 'waiting_user' | 'resolved' | 'closed';
export type AuthorType = 'technician' | 'requester' | 'system' | 'assistant';

export interface Attachment {
  id: number;
  fileName: string;
  contentType: string;
  size: number;
}

export interface Ticket {
  id: number;
  title: string;
  status: TicketStatus;
  priority: string;
  createdAt: string;
  updatedAt: string;
  assignedToName: string | null;
  chatEnabled: boolean;
  lastMessageAt: string | null;
}

export interface Message {
  id: number;
  authorType: AuthorType;
  authorName: string;
  body: string;
  createdAt: string;
  attachments: Attachment[] | null;
}

export interface TicketDetail extends Ticket {
  description: string;
  messages: Message[];
  attachments: Attachment[];
}

export interface SessionInfo {
  hostname: string;
  username: string;
  clientName: string;
  siteName: string;
  connected: boolean;
  realtime: boolean;
  /** O assistente de IA faz o primeiro atendimento dos chamados abertos pelo app. */
  assistantEnabled?: boolean;
  assistantName?: string;
  /** Há perguntas frequentes publicadas para a ajuda do app. */
  faqEnabled?: boolean;
  error?: string;
}

/** Pergunta da ajuda, com o começo da resposta. */
export interface FaqItem {
  id: number;
  question: string;
  category: string | null;
  excerpt: string;
}

export interface FaqList {
  categories: string[];
  entries: FaqItem[];
}

export interface FaqEntry {
  id: number;
  question: string;
  answer: string;
  category: string | null;
  updatedAt: string;
}

export interface CreateResult {
  ticket: Ticket;
  screenshotAttached: boolean;
  screenshotError?: string;
}

export interface TicketMessageEvent {
  ticketId: number;
  message: Message;
}

export interface NavigateEvent {
  view: 'new' | 'ticket' | 'list';
  id: number;
}

export type RunStatus = 'running' | 'ok' | 'warning' | 'error' | 'cancelled' | 'timeout';

export interface SelfServiceTask {
  module: string;
  key: string;
  label: string;
  description: string;
}

export interface SelfServiceOptions {
  enabled: boolean;
  tasks: SelfServiceTask[];
}

export interface SelfServiceStart {
  runId: string;
}

export interface SelfServiceRun {
  runId: string;
  status: RunStatus;
  progress: number;
  label: string;
  messages: string[];
}

/** Payload de tray:selfService (evento selfServiceChanged do hub). */
export interface SelfServiceEvent {
  runId: string;
  status: RunStatus;
  progress: number;
  message: string;
}

export type Unsubscribe = () => void;

/** Contrato entre a interface e o processo Go (ou o simulador usado no desenvolvimento). */
/** Evento do acesso remoto vindo do agente (aviso, pedido de aceite ou fim). */
export interface RemoteEvent {
  event: 'remote-notify' | 'remote-ask' | 'remote-ended';
  session: string;
  technician?: string;
  timeout?: number;
}

export type DeviceKind = 'keyboard' | 'pointer' | 'touchpad' | 'camera' | 'usb';

/** Periférico presente, lido pelo app na sessão do usuário (SetupAPI no Windows, /sys no Linux). */
export interface DeviceInfo {
  id: string;
  kind: DeviceKind;
  name: string;
  model?: string;
  manufacturer?: string;
  /** "USB", "Bluetooth" ou "Interno". */
  bus?: string;
  ok: boolean;
  problem?: string;
}

export interface DeviceSnapshot {
  /** Falso no sistema em que o app não lê os dispositivos (macOS). */
  supported: boolean;
  devices: DeviceInfo[];
  error?: string;
}

/** Layout de teclado ativo: KLID no Windows ("00010416"), layout do XKB no Linux ("br"). */
export interface KeyboardLayoutInfo {
  id: string;
  name: string;
  installed?: string[];
  error?: string;
}

/** Teste de periféricos aberto pelo técnico no console (o app abre a tela sozinho). */
export interface PeripheralTestInfo {
  testId: number;
  section: 'keyboard' | 'pointer' | 'usb' | 'camera';
  technician: string;
}

/** Payload de tray:peripheralTest: o teste aberto (active) ou o fim dele. */
export interface PeripheralTestEvent {
  active: boolean;
  testId: number;
  section?: PeripheralTestInfo['section'];
  technician?: string;
}

export interface Backend {
  session(): Promise<SessionInfo>;
  listTickets(): Promise<Ticket[]>;
  getTicket(id: number): Promise<TicketDetail>;
  createTicket(title: string, description: string, includeScreenshot: boolean): Promise<CreateResult>;
  sendMessage(ticketId: number, body: string): Promise<Message>;
  attachment(ticketId: number, attachmentId: number): Promise<string>;
  onTicketMessage(cb: (e: TicketMessageEvent) => void): Unsubscribe;
  onTicketChanged(cb: (t: Ticket) => void): Unsubscribe;
  onConnection(cb: (realtime: boolean) => void): Unsubscribe;
  onNavigate(cb: (e: NavigateEvent) => void): Unsubscribe;
  onRefresh(cb: () => void): Unsubscribe;
  selfServiceOptions(): Promise<SelfServiceOptions>;
  runSelfService(module: string, key: string): Promise<SelfServiceStart>;
  selfServiceRun(runId: string): Promise<SelfServiceRun>;
  onSelfService(cb: (e: SelfServiceEvent) => void): Unsubscribe;
  onRemote(cb: (e: RemoteEvent) => void): Unsubscribe;
  remoteAnswer(session: string, accept: boolean): Promise<void>;
  remoteEnd(session: string): Promise<void>;
  listFaq(search: string, category: string): Promise<FaqList>;
  getFaq(id: number): Promise<FaqEntry>;
  faqFeedback(id: number, helpful: boolean): Promise<void>;
  suggestFaq(question: string): Promise<void>;
  devices(): Promise<DeviceSnapshot>;
  keyboardLayout(): Promise<KeyboardLayoutInfo>;
  /** Teste aberto pelo técnico, para a interface que carrega depois do pedido. */
  peripheralTest(): Promise<PeripheralTestInfo | null>;
  onPeripheralTest(cb: (e: PeripheralTestEvent) => void): Unsubscribe;
  /** Estado da tela de teste, que o técnico vê ao vivo no console. */
  reportPeripheralTest(testId: number, state: unknown): Promise<void>;
  endPeripheralTest(testId: number): Promise<void>;
}
