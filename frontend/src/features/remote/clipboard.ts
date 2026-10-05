import type { ClipboardBody } from './protocol';

/** Limite do texto sincronizado em bytes UTF-8 (contrato, secao 6). */
export const MAX_CLIPBOARD_BYTES = 1 << 20;

export interface ClipboardApi {
  writeText(text: string): Promise<void>;
  readText(): Promise<string>;
}

export async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto.subtle as SubtleCrypto | undefined;
  if (!subtle) return '';
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Ponte entre a area de transferencia do navegador e a da estacao (contrato, secao 6):
 * grava o que chega da estacao (ou guarda ate o proximo gesto, se o navegador recusar) e envia o texto local
 * no Ctrl+V e no foco, sem eco do ultimo texto trocado.
 */
export class ClipboardBridge {
  enabled = false;
  private last: string | null = null;
  private pending: string | null = null;

  constructor(
    private readonly send: (body: ClipboardBody) => void,
    private readonly api: ClipboardApi | undefined = typeof navigator === 'undefined' ? undefined : navigator.clipboard,
  ) {}

  /** Texto que veio da estacao. Devolve true quando ja ficou na area de transferencia local. */
  async fromRemote(body: ClipboardBody): Promise<boolean> {
    if (body.kind !== 'text' || body.text === undefined) return false;
    this.last = body.text;
    return this.write(body.text);
  }

  private async write(text: string): Promise<boolean> {
    if (!this.api) return false;
    try {
      await this.api.writeText(text);
      this.pending = null;
      return true;
    } catch {
      // Sem gesto do usuario o navegador pode recusar: grava no proximo clique ou tecla dentro da tela.
      this.pending = text;
      return false;
    }
  }

  get hasPending(): boolean {
    return this.pending !== null;
  }

  /** Chamado num gesto do usuario (clique ou tecla) para gravar o que ficou pendente. */
  async flushPending(): Promise<void> {
    if (this.pending !== null) await this.write(this.pending);
  }

  /** Texto local (do evento paste ou da leitura no foco). Devolve true se foi enviado a estacao. */
  async local(text: string): Promise<boolean> {
    if (!this.enabled || text === '' || text === this.last) return false;
    if (new TextEncoder().encode(text).length > MAX_CLIPBOARD_BYTES) return false;
    this.last = text;
    this.send({ kind: 'text', text, hash: await sha256Hex(text) });
    return true;
  }

  /** No foco da janela: le a area de transferencia local quando o navegador ja deu a permissao (Chrome e Edge). */
  async readOnFocus(): Promise<void> {
    if (!this.enabled || !this.api) return;
    try {
      const status = await navigator.permissions.query({ name: 'clipboard-read' as PermissionName });
      if (status.state !== 'granted') return;
      await this.local(await this.api.readText());
    } catch {
      // Firefox e Safari nao tem essa permissao: o texto local segue pelo Ctrl+V.
    }
  }
}
