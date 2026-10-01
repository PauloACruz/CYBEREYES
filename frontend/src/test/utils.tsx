import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { vi } from 'vitest';
import type { MeDto } from '../api/types';
import { AppProviders } from '../app/AppProviders';
import { connectApiClient } from '../app/connectApiClient';
import { createQueryClient } from '../app/queryClient';
import { routes } from '../app/routes';

export type MockHandler = (init: RequestInit | undefined, url: URL) => Response | Promise<Response>;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export function problem(status: number, code: string, title: string): Response {
  return new Response(JSON.stringify({ type: 'about:blank', status, code, title }), {
    status,
    headers: { 'Content-Type': 'application/problem+json' },
  });
}

/** Substitui fetch; as chaves sao "METODO /caminho" (sem query string). */
export function mockFetch(handlers: Record<string, MockHandler>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, 'http://localhost');
    const key = `${init?.method ?? 'GET'} ${url.pathname}`;
    const handler = handlers[key];
    if (!handler) return problem(404, 'NOT_FOUND', `Sem mock para ${key}`);
    return handler(init, url);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

export function makeMe(overrides: Partial<MeDto> = {}): MeDto {
  return {
    id: 'u1',
    username: 'tecnico',
    email: 'tecnico@example.com',
    fullName: 'Maria Silva',
    isSuperuser: false,
    roles: [],
    permissions: [],
    twoFactorEnabled: true,
    mfaSatisfied: true,
    ...overrides,
  };
}

export function renderApp(initialPath: string) {
  const queryClient = createQueryClient();
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });
  connectApiClient(router, queryClient);
  const utils = render(
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { ...utils, router, queryClient };
}
