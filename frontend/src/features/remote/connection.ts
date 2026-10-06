import {
  ackFrame,
  CLOSE,
  FRAME,
  jsonFrame,
  parseFrameEnd,
  parseTile,
  readJson,
  type ClipboardBody,
  type CursorBody,
  type FilesCopiedBody,
  type FrameEndFrame,
  type HelloBody,
  type RemoteDisplay,
  type TileFrame,
} from './protocol';

export type ConnectionPhase = 'connecting' | 'waiting-agent' | 'connected' | 'closed';

export interface ConnectionHandlers {
  onPhase: (phase: ConnectionPhase) => void;
  onHello: (hello: HelloBody) => void;
  onDisplays: (displays: RemoteDisplay[], active: number) => void;
  onTile: (tile: TileFrame) => void;
  /** Cursor remoto separado da imagem (quando o visualizador pediu settings.cursor). */
  onCursor?: (cursor: CursorBody) => void;
  /** Deve devolver uma promessa que termina quando o quadro foi desenhado (o ACK sai depois dela). */
  onFrameEnd: (end: FrameEndFrame) => Promise<void>;
  onConsent: (state: 'waiting' | 'accepted' | 'denied' | 'timeout') => void;
  onClipboard: (body: ClipboardBody) => void;
  onFilesCopied: (body: FilesCopiedBody) => void;
  onError: (code: string, message: string) => void;
  onClosed: (reason: string) => void;
}

/** Mensagens para os codigos de fechamento do relay (contrato, secao 4.3). */
export function closeReason(code: number, reason: string): string {
  switch (code) {
    case CLOSE.auth:
      return 'A autenticação da sessão falhou. Abra o acesso remoto de novo.';
    case CLOSE.forbidden:
      return 'Você perdeu a permissão de acesso remoto.';
    case CLOSE.peerTimeout:
      return 'A máquina não respondeu a tempo.';
    case CLOSE.duplicate:
      return 'Esta sessão já está aberta em outra janela.';
    case CLOSE.ended:
      return endReasonText(reason);
    case CLOSE.rate:
      return 'Muitos eventos enviados em pouco tempo.';
    default:
      return 'A conexão foi encerrada.';
  }
}

export function endReasonText(reason: string | null | undefined): string {
  switch (reason) {
    case 'technician':
      return 'Sessão encerrada.';
    case 'user':
      return 'O usuário da máquina encerrou o acesso.';
    case 'agent':
      return 'A máquina encerrou a sessão.';
    case 'timeout':
      return 'Sessão encerrada por tempo (inatividade ou duração máxima).';
    case 'permission':
      return 'Sessão encerrada: permissão retirada.';
    case 'consent-denied':
      return 'O usuário recusou o acesso.';
    case 'consent-timeout':
      return 'O usuário não respondeu ao pedido de acesso.';
    case 'server':
      return 'Sessão encerrada pelo servidor.';
    default:
      return 'Sessão encerrada.';
  }
}

/** Endereco do relay na mesma origem do console (o Nginx e o proxy do Vite repassam o WebSocket). */
export function relayUrl(sessionId: string, location: Pick<Location, 'protocol' | 'host'> = window.location, channel: 'desktop' | 'rdp' = 'desktop'): string {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${location.host}/api/remote/relay/${sessionId}/${channel}`;
}

/** Conexao do visualizador com o relay: AUTH, emparelhamento, quadros e ACK depois do desenho. */
export class RemoteConnection {
  private socket: WebSocket | null = null;
  private drawing: Promise<void> = Promise.resolve();
  private closedByUs = false;

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly handlers: ConnectionHandlers,
    private readonly createSocket: (url: string) => WebSocket = (u) => new WebSocket(u),
  ) {}

  connect(): void {
    this.handlers.onPhase('connecting');
    const socket = this.createSocket(this.url);
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => socket.send(jsonFrame(FRAME.auth, { token: this.token, role: 'viewer', proto: 1 }));
    socket.onmessage = (event: MessageEvent<ArrayBuffer>) => this.dispatch(new Uint8Array(event.data));
    socket.onclose = (event) => {
      this.handlers.onPhase('closed');
      this.handlers.onClosed(this.closedByUs ? 'Sessão encerrada.' : closeReason(event.code, event.reason));
    };
    this.socket = socket;
  }

  private dispatch(frame: Uint8Array<ArrayBuffer>): void {
    if (frame.length === 0) return;
    switch (frame[0]) {
      case FRAME.authOk:
        this.handlers.onPhase('waiting-agent');
        break;
      case FRAME.paired:
        this.handlers.onPhase('connected');
        break;
      case FRAME.hello:
        this.handlers.onHello((readJson(frame) as HelloBody));
        break;
      case FRAME.displays: {
        const body = (readJson(frame) as { displays: RemoteDisplay[]; active: number });
        this.handlers.onDisplays(body.displays, body.active);
        break;
      }
      case FRAME.tile:
        this.handlers.onTile(parseTile(frame));
        break;
      case FRAME.cursor:
        this.handlers.onCursor?.(readJson(frame) as CursorBody);
        break;
      case FRAME.frameEnd: {
        const end = parseFrameEnd(frame);
        const received = performance.now();
        this.drawing = this.drawing
          .then(() => this.handlers.onFrameEnd(end))
          .catch(() => undefined)
          .then(() => this.send(ackFrame(end.frame, received)));
        break;
      }
      case FRAME.consent:
        this.handlers.onConsent((readJson(frame) as { state: 'waiting' | 'accepted' | 'denied' | 'timeout' }).state);
        break;
      case FRAME.clipboard:
        this.handlers.onClipboard((readJson(frame) as ClipboardBody));
        break;
      case FRAME.filesCopied:
        this.handlers.onFilesCopied((readJson(frame) as FilesCopiedBody));
        break;
      case FRAME.error: {
        const body = (readJson(frame) as { code: string; message: string });
        this.handlers.onError(body.code, body.message);
        break;
      }
      default:
        break;
    }
  }

  send(frame: Uint8Array<ArrayBuffer>): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(frame);
  }

  sendJson(type: number, body: unknown): void {
    this.send(jsonFrame(type, body));
  }

  close(): void {
    this.closedByUs = true;
    this.socket?.close(1000);
  }
}
