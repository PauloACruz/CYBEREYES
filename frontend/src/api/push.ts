import { api } from './client';
import type { PushConfig, PushPreferences, PushSubscriptionDto, PushSubscriptionRequest, PushTestResult } from './types';

export const pushApi = {
  config: () => api.get<PushConfig>('/api/push/config'),
  /** Inscricao deste aparelho (404 quando ainda nao foi ativada aqui, ou e de outro usuario). */
  find: (endpoint: string) => api.post<PushSubscriptionDto>('/api/push/subscription/find', { endpoint }, { silent: true }),
  save: (body: PushSubscriptionRequest) => api.put<PushSubscriptionDto>('/api/push/subscription', body),
  remove: (endpoint: string, options?: { silent?: boolean }) => api.post('/api/push/subscription/delete', { endpoint }, options),
  test: (endpoint: string) => api.post<PushTestResult>('/api/push/test', { endpoint }),
};

export const DEFAULT_PUSH_PREFERENCES: PushPreferences = { newTickets: true, updates: true, messages: true, insights: true };
