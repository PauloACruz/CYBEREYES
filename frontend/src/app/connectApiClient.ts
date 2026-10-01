import type { QueryClient } from '@tanstack/react-query';
import { configureApiClient } from '../api/client';
import { PATHS } from './paths';

interface NavigableRouter {
  state: { location: { pathname: string } };
  navigate: (to: string, opts?: { replace?: boolean }) => Promise<void> | void;
}

/** Liga o tratamento global de 401/403 do cliente HTTP ao roteador e ao cache. */
export function connectApiClient(router: NavigableRouter, queryClient: QueryClient): void {
  configureApiClient({
    onUnauthorized: () => {
      queryClient.removeQueries();
      if (router.state.location.pathname !== PATHS.login) {
        void router.navigate(PATHS.login, { replace: true });
      }
    },
    onMfaRequired: () => {
      if (router.state.location.pathname !== PATHS.twoFactorSetup) {
        void router.navigate(PATHS.twoFactorSetup, { replace: true });
      }
    },
  });
}
