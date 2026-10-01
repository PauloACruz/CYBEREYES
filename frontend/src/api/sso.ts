import { api, buildUrl } from './client';
import type {
  OidcDiscoveryTestResult,
  OidcProviderDto,
  SaveOidcProvider,
  SsoLoginOptions,
  SsoProviderOption,
  SsoSettingsDto,
} from './types';

/** So caminhos relativos do proprio console (mesma regra do servidor). */
export function safeReturnUrl(value: unknown): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : '/';
}

export function ssoStartUrl(providerId: number, returnUrl: string): string {
  return buildUrl(`/api/auth/sso/${encodeURIComponent(String(providerId))}/start`, { returnUrl: safeReturnUrl(returnUrl) });
}

function isProviderOption(value: unknown): value is SsoProviderOption {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'name' in value &&
    (typeof value.id === 'number' || typeof value.id === 'string') &&
    typeof value.name === 'string'
  );
}

/** Aceita { providers, passwordLoginEnabled } ou so a lista de provedores (login por senha liberado). */
export function normalizeLoginOptions(raw: unknown): SsoLoginOptions {
  if (Array.isArray(raw)) return { providers: raw.filter(isProviderOption), passwordLoginEnabled: true };
  if (typeof raw === 'object' && raw !== null) {
    const providers = 'providers' in raw && Array.isArray(raw.providers) ? raw.providers.filter(isProviderOption) : [];
    const passwordLoginEnabled = 'passwordLoginEnabled' in raw && raw.passwordLoginEnabled === false ? false : true;
    return { providers, passwordLoginEnabled };
  }
  return { providers: [], passwordLoginEnabled: true };
}

export const ssoApi = {
  loginOptions: async () => normalizeLoginOptions(await api.get<unknown>('/api/auth/sso/providers', undefined, { silent: true })),
  providers: () => api.get<OidcProviderDto[]>('/api/sso/providers'),
  create: (body: SaveOidcProvider) => api.post<OidcProviderDto>('/api/sso/providers', body),
  update: (id: number, body: SaveOidcProvider) => api.put<OidcProviderDto>(`/api/sso/providers/${encodeURIComponent(String(id))}`, body),
  remove: (id: number) => api.delete(`/api/sso/providers/${encodeURIComponent(String(id))}`),
  test: (authority: string) => api.post<OidcDiscoveryTestResult>('/api/sso/providers/test', { authority }, { silent: true }),
  settings: () => api.get<SsoSettingsDto>('/api/sso/settings'),
  saveSettings: (body: SsoSettingsDto) => api.put<SsoSettingsDto>('/api/sso/settings', body),
};
