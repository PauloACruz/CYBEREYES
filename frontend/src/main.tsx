import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/notifications/styles.css';
import { AppProviders } from './app/AppProviders';
import { connectApiClient } from './app/connectApiClient';
import { createQueryClient } from './app/queryClient';
import { routes } from './app/routes';

const queryClient = createQueryClient();
const router = createBrowserRouter(routes);
connectApiClient(router, queryClient);

const container = document.getElementById('root');
if (!container) throw new Error('Elemento #root não encontrado');

createRoot(container).render(
  <StrictMode>
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
);
