import type { IronError, UserInteraction } from '@devolutions/iron-remote-desktop';

/** Dados para o cliente RDP do navegador falar com o relay (canal rdp, contrato secao 5.4). */
export interface RdpTarget {
  /** WebSocket do relay no canal rdp. */
  proxyAddress: string;
  /** Token de uso unico do visualizador: vai no campo proxy_auth do RDCleanPath. */
  authToken: string;
  destination: string;
  username: string;
  password: string;
  clipboard: boolean;
}

export interface RdpSession {
  ui: UserInteraction;
  /** Termina quando a sessao RDP acaba, com o motivo informado pelo cliente. */
  done: Promise<string>;
  close: () => void;
}

/**
 * Carrega o cliente RDP do navegador (IronRDP: componente web e WASM de cerca de 6 MB, baixados so quando usados),
 * monta o componente no host e conecta pelo relay.
 */
export async function startRdp(host: HTMLElement, target: RdpTarget): Promise<RdpSession> {
  const [{ Backend, init }] = await Promise.all([
    import('@devolutions/iron-remote-desktop-rdp'),
    // Registra o elemento <iron-remote-desktop>.
    import('@devolutions/iron-remote-desktop'),
  ]);
  await init('WARN');
  const element = document.createElement('iron-remote-desktop') as HTMLElement & { module?: unknown };
  element.setAttribute('scale', 'fit');
  element.setAttribute('flexcenter', 'true');
  element.module = Backend;
  const ready = new Promise<UserInteraction>((resolve) => {
    element.addEventListener('ready', (event) => resolve((event as CustomEvent<{ irgUserInteraction: UserInteraction }>).detail.irgUserInteraction), {
      once: true,
    });
  });
  host.appendChild(element);
  const ui = await ready;
  ui.setEnableClipboard(target.clipboard);
  ui.setEnableAutoClipboard(target.clipboard);
  const config = ui
    .configBuilder()
    .withUsername(target.username)
    .withPassword(target.password)
    .withDestination(target.destination)
    .withProxyAddress(target.proxyAddress)
    .withAuthToken(target.authToken)
    .build();
  let info;
  try {
    info = await ui.connect(config);
  } catch (error) {
    element.remove();
    throw error;
  }
  ui.setVisibility(true);
  return {
    ui,
    done: info.run().then((end) => end.reason()),
    close: () => {
      ui.shutdown();
      element.remove();
    },
  };
}

// Valores de IronErrorKind (index.d.ts do @devolutions/iron-remote-desktop); o enum nao existe em tempo de execucao.
const KIND = { wrongPassword: 1, logonFailure: 2, accessDenied: 3, rdCleanPath: 4, proxyConnect: 5, negotiationFailure: 6 } as const;

function isIronError(error: unknown): error is IronError {
  return typeof error === 'object' && error !== null && 'kind' in error && typeof error.kind === 'function';
}

/** Mensagem para o tecnico a partir do erro do cliente RDP; o codigo HTTP vem do relay ou do EYES (RDCleanPath). */
export function rdpErrorMessage(error: unknown): string {
  if (!isIronError(error)) return 'Não foi possível abrir o RDP do GNOME.';
  const kind: number = error.kind();
  switch (kind) {
    case KIND.wrongPassword:
    case KIND.logonFailure:
    case KIND.accessDenied:
      return 'O RDP do GNOME recusou a credencial temporária. Abra o acesso de novo.';
    case KIND.negotiationFailure:
      return 'O RDP do GNOME recusou a negociação de segurança.';
    case KIND.proxyConnect:
      return 'Não foi possível conectar ao relay do acesso remoto.';
    case KIND.rdCleanPath: {
      const details = error.rdcleanpathDetails();
      if (details?.httpStatusCode === 401) return 'A autenticação da sessão falhou. Abra o acesso remoto de novo.';
      if (details?.httpStatusCode === 409) return 'Esta sessão já está aberta em outra janela.';
      if (details?.httpStatusCode === 504) return 'A máquina não respondeu a tempo.';
      if (details?.httpStatusCode === 502) return 'O EYES não conseguiu falar com o RDP do GNOME na máquina.';
      if (details?.tlsAlertCode !== undefined) return 'O RDP do GNOME recusou o TLS.';
      return 'O relay recusou a conexão RDP.';
    }
    default:
      return 'A conexão RDP falhou.';
  }
}
