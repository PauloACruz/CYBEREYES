import type { QueryClient } from '@tanstack/react-query';
import { configureApiClient } from '../api/client';
import { PATHS } from './paths';

interface NavigableRouter {
  state: { location: { pathname: string; search: string } };
  navigate: (to: string, opts?: { replace?: boolean; state?: unknown }) => Promise<void> | void;
}

/** Liga o tratamento global de 401/403 do cliente HTTP ao roteador e ao cache. */
export function connectApiClient(router: NavigableRouter, queryClient: QueryClient): void {
  configureApiClient({
    onUnauthorized: () => {
      queryClient.removeQueries();
      const { pathname, search } = router.state.location;
      if (pathname !== PATHS.login) {
        // Caminho de origem: o login por SSO volta para ele (returnUrl).
        const isAuthPage = pathname === PATHS.loginTwoFactor || pathname === PATHS.twoFactorSetup;
        void router.navigate(PATHS.login, { replace: true, state: isAuthPage ? undefined : { from: `${pathname}${search}` } });
      }
    },
    onMfaRequired: () => {
      if (router.state.location.pathname !== PATHS.twoFactorSetup) {
        void router.navigate(PATHS.twoFactorSetup, { replace: true });
      }
    },
  });
}
