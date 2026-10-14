import { MOBILE_PATHS } from '../../app/paths';
import { hasAppReturnPath } from '../../auth/returnPath';

const CONSOLE_KEY = 'cybereyes:console-no-celular';

function matches(query: string): boolean {
  try {
    return window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

/** Tela do aparelho pequena: no modo "versao para computador" do navegador a janela fica larga, mas a tela segue a do celular. */
function smallScreen(): boolean {
  try {
    const side = Math.min(window.screen.width, window.screen.height);
    return side > 0 && side <= 600;
  } catch {
    return false;
  }
}

/** Celular: toque com tela estreita (ou tela de celular), ou o app instalado (PWA aberto em janela propria). */
export function isPhone(): boolean {
  return (matches('(pointer: coarse)') && (matches('(max-width: 768px)') || smallScreen())) || matches('(display-mode: standalone)');
}

/** O tecnico escolheu o console completo no celular ("Abrir o console completo" no app). */
export function prefersConsole(): boolean {
  try {
    return localStorage.getItem(CONSOLE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setPrefersConsole(value: boolean): void {
  try {
    if (value) localStorage.setItem(CONSOLE_KEY, '1');
    else localStorage.removeItem(CONSOLE_KEY);
  } catch {
    // Armazenamento bloqueado: o celular volta a abrir no app.
  }
}

/** Abre no app do tecnico: celular sem a escolha pelo console completo. */
export function wantsApp(): boolean {
  return isPhone() && !prefersConsole();
}

/** Login no celular ou a caminho de uma tela do app: aparece como a entrada do app do tecnico. */
export function isAppLogin(): boolean {
  return wantsApp() || hasAppReturnPath();
}

/** Estado dos links do app que levam ao console de proposito ("Ver todos no console"): o console nao devolve ao app. */
export const CONSOLE_STATE = { console: true } as const;

/**
 * Tela do app equivalente a um endereco do console (lista e detalhe de agentes, chamados e aplicacoes), ou null.
 * Uma aba do console no endereco (?aba=arquivos, ?aba=scripts) so existe no console e fica nele.
 */
export function appPathFor(pathname: string, search: string, state: unknown): string | null {
  if ((state as { console?: unknown } | null)?.console === true) return null;
  if (new URLSearchParams(search).has('aba')) return null;
  const match = /^\/(agentes|chamados|aplicacoes)(?:\/(\d+))?\/?$/.exec(pathname);
  if (!match) return null;
  return `${MOBILE_PATHS.root}/${match[1]}${match[2] ? `/${match[2]}` : ''}`;
}
