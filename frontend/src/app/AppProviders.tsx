import type { ReactNode } from 'react';
import { MantineProvider } from '@mantine/core';
import { DatesProvider } from '@mantine/dates';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import 'dayjs/locale/pt-br';
import { cssVariablesResolver, theme } from './theme';

interface AppProvidersProps {
  queryClient: QueryClient;
  children: ReactNode;
}

export function AppProviders({ queryClient, children }: AppProvidersProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver} defaultColorScheme="dark">
        <DatesProvider settings={{ locale: 'pt-br', firstDayOfWeek: 0 }}>
          <ModalsProvider labels={{ confirm: 'Confirmar', cancel: 'Cancelar' }}>
            <Notifications position="top-right" />
            {children}
          </ModalsProvider>
        </DatesProvider>
      </MantineProvider>
    </QueryClientProvider>
  );
}
