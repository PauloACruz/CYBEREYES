/** Mensagem do HubException ("...HubException: texto") ou nulo. */
export function hubErrorDetail(error: unknown): string | null {
  const text = error instanceof Error ? error.message : '';
  return text.split('HubException:')[1]?.trim() ?? null;
}
