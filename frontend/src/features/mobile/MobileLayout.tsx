import { Suspense } from 'react';
import { Box, Center, Loader } from '@mantine/core';
import { Navigate, Outlet } from 'react-router';
import { MOBILE_PATHS, PATHS } from '../../app/paths';
import { PERMISSIONS } from '../../api/types';
import { hasPermission } from '../../auth/permissions';
import { useMe } from '../../auth/useMe';
import { ConsoleHubContext } from '../../realtime/consoleHubContext';
import { useConsoleHub } from '../../realtime/useConsoleHub';

/** Casca do app do tecnico: tela cheia, sem o menu lateral do console, com o hub em tempo real. */
export function MobileLayout() {
  const hub = useConsoleHub();
  return (
    <Box mih="100dvh" bg="var(--ce-bg-base)" c="var(--ce-text-primary)">
      <ConsoleHubContext.Provider value={hub}>
        <Suspense
          fallback={
            <Center py="xl" mih="60dvh">
              <Loader aria-label="Carregando" />
            </Center>
          }
        >
          <Outlet />
        </Suspense>
      </ConsoleHubContext.Provider>
    </Box>
  );
}

/** Entrada do app: abre a primeira area que o papel do usuario pode ver. */
export function MobileHome() {
  const { data: me } = useMe();
  if (hasPermission(me, PERMISSIONS.ticketsView)) return <Navigate to={MOBILE_PATHS.tickets} replace />;
  if (hasPermission(me, PERMISSIONS.agentsView)) return <Navigate to={MOBILE_PATHS.agents} replace />;
  if (hasPermission(me, PERMISSIONS.appsView)) return <Navigate to={MOBILE_PATHS.webApps} replace />;
  if (me) return <Navigate to={MOBILE_PATHS.more} replace />;
  return <Navigate to={PATHS.dashboard} replace />;
}
