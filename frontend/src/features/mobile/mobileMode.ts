import { hasAppReturnPath } from '../../auth/returnPath';

const CONSOLE_KEY = 'cybereyes:console-no-celular';

function matches(query: string): boolean {
  try {
    return window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

/** Celular: tela estreita com toque, ou o app instalado (PWA aberto em janela propria). */
export function isPhone(): boolean {
  return matches('(max-width: 768px) and (pointer: coarse)') || matches('(display-mode: standalone)');
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
