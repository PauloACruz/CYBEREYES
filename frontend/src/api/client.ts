import { notifications } from '@mantine/notifications';
import type { ErrorCode, ProblemDetails } from './types';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | undefined;
  readonly title: string;
  readonly problem: ProblemDetails;

  constructor(status: number, problem: ProblemDetails) {
    const title = problem.title ?? defaultTitle(status);
    super(title);
    this.name = 'ApiError';
    this.status = status;
    this.code = problem.code;
    this.title = title;
    this.problem = problem;
  }

  get fieldErrors(): Record<string, string[]> {
    return this.problem.errors ?? {};
  }
}

export interface ApiClientHandlers {
  onUnauthorized: () => void;
  onMfaRequired: () => void;
  onError: (error: ApiError) => void;
}

function showErrorNotification(error: ApiError): void {
  notifications.show({
    color: 'red',
    title: error.title,
    message: error.problem.detail ?? describeStatus(error.status),
  });
}

const defaultHandlers: ApiClientHandlers = {
  onUnauthorized: () => undefined,
  onMfaRequired: () => undefined,
  onError: showErrorNotification,
};

let handlers: ApiClientHandlers = defaultHandlers;

export function configureApiClient(next: Partial<ApiClientHandlers>): void {
  handlers = { ...defaultHandlers, ...next };
}

export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
  /** Nao dispara a notificacao global de erro (o chamador trata). */
  silent?: boolean;
}

// Erros de 401 que significam "dado digitado incorreto" e nao "sessao ausente".
const INPUT_401_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>(['INVALID_CREDENTIALS', 'INVALID_CODE']);

export function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.append(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, signal, silent = false } = options;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    const error = new ApiError(0, { title: 'Falha de comunicação com o servidor' });
    if (!silent) handlers.onError(error);
    throw error;
  }

  if (response.ok) {
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    const data: unknown = text ? JSON.parse(text) : undefined;
    return data as T;
  }

  const error = new ApiError(response.status, await readProblem(response));
  dispatchError(error, silent);
  throw error;
}

function dispatchError(error: ApiError, silent: boolean): void {
  if (error.status === 401 && !(error.code && INPUT_401_CODES.has(error.code))) {
    handlers.onUnauthorized();
    return;
  }
  if (error.status === 403 && error.code === 'MFA_REQUIRED') {
    handlers.onMfaRequired();
    return;
  }
  if (!silent) handlers.onError(error);
}

async function readProblem(response: Response): Promise<ProblemDetails> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('json')) return { status: response.status };
  try {
    const parsed: unknown = await response.json();
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    // corpo invalido: cai no titulo padrao
  }
  return { status: response.status };
}

function defaultTitle(status: number): string {
  switch (status) {
    case 400:
      return 'Dados inválidos';
    case 401:
      return 'Sessão expirada';
    case 403:
      return 'Acesso negado';
    case 404:
      return 'Recurso não encontrado';
    case 409:
      return 'Conflito';
    case 429:
      return 'Muitas tentativas';
    default:
      return status >= 500 ? 'Erro no servidor' : `Erro inesperado (HTTP ${status})`;
  }
}

function describeStatus(status: number): string {
  if (status === 0) return 'Verifique sua conexão e tente novamente.';
  if (status === 429) return 'Aguarde alguns instantes antes de tentar de novo.';
  if (status >= 500) return 'Tente novamente em instantes.';
  return 'Revise os dados e tente novamente.';
}

export const api = {
  get: <T>(path: string, query?: Record<string, QueryValue>, options?: Omit<RequestOptions, 'method' | 'query'>) =>
    request<T>(path, { ...options, method: 'GET', query }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'PUT', body }),
  delete: <T = undefined>(path: string, options?: Omit<RequestOptions, 'method'>) =>
    request<T>(path, { ...options, method: 'DELETE' }),
};
