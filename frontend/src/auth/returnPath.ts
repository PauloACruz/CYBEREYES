import { MOBILE_PATHS, PATHS } from '../app/paths';

const KEY = 'cybereyes:voltar-para';

/** So caminhos do app do tecnico voltam depois do login; o resto segue para o Painel. */
function isAppPath(path: string): boolean {
  return path === MOBILE_PATHS.root || path.startsWith(`${MOBILE_PATHS.root}/`) || path.startsWith(`${MOBILE_PATHS.root}?`);
}

/** Guarda a tela do app do tecnico aberta antes de pedir login, para voltar a ela depois. */
export function rememberReturnPath(path: string): void {
  if (!isAppPath(path)) return;
  try {
    sessionStorage.setItem(KEY, path);
  } catch {
    // Armazenamento bloqueado: depois do login o usuario cai no Painel.
  }
}

/** Destino depois do login: a tela guardada do app ou o Painel. Le uma vez e apaga. */
export function takeReturnPath(): string {
  try {
    const saved = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    if (saved && isAppPath(saved)) return saved;
  } catch {
    // Sem armazenamento: segue para o Painel.
  }
  return PATHS.dashboard;
}
