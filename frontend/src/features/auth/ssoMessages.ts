import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import { ssoApi } from '../../api/sso';

const SSO_ERROR_MESSAGES: Record<string, string> = {
  SSO_PROVIDER_ERROR: 'O provedor de identidade não concluiu o login. Tente novamente ou fale com o administrador.',
  SSO_INVALID_STATE: 'A tentativa de login expirou ou foi aberta em outra janela. Clique de novo no botão do provedor.',
  SSO_INVALID_TOKEN: 'Não foi possível validar a resposta do provedor de identidade. Tente novamente.',
  SSO_USER_NOT_FOUND: 'Sua conta não tem acesso a este console. Peça a um administrador para liberar seu usuário.',
  SSO_USER_DISABLED: 'Seu usuário está desativado ou bloqueado. Fale com um administrador.',
  SSO_DOMAIN_NOT_ALLOWED: 'O domínio do seu e-mail não tem permissão para entrar por este provedor.',
};

export const SSO_GENERIC_ERROR = 'Não foi possível entrar pelo provedor de identidade. Tente novamente.';

export function ssoErrorMessage(code: string): string {
  return SSO_ERROR_MESSAGES[code] ?? SSO_GENERIC_ERROR;
}

/** Provedores ativos e se o login por senha esta liberado (rota publica). */
export function useSsoLoginOptions() {
  return useQuery({ queryKey: queryKeys.ssoLoginOptions, queryFn: ssoApi.loginOptions, retry: false, staleTime: 60_000 });
}

/** Caminho de origem guardado pelo RequireAuth no state da navegacao. */
export function returnPathFromState(state: unknown): string {
  if (state && typeof state === 'object' && 'from' in state && typeof state.from === 'string') return state.from;
  return '/';
}
