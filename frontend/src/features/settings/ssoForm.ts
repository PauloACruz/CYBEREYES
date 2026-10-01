const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/** https obrigatorio; http so com host localhost (regra do contrato). */
export function validateAuthority(value: string): string | null {
  const text = value.trim();
  if (!text) return 'Informe a authority';
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return 'Informe uma URL válida';
  }
  if (url.protocol === 'https:') return null;
  if (url.protocol === 'http:' && url.hostname === 'localhost') return null;
  return 'Use https (http só para localhost)';
}

export function validateDomains(domains: string[]): string | null {
  const invalid = domains.map((d) => d.trim().replace(/^@/, '')).filter((d) => d && !DOMAIN_RE.test(d));
  return invalid.length > 0 ? `Domínio inválido: ${invalid.join(', ')}` : null;
}
