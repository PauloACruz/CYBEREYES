/** Tamanho maximo do titulo tirado da descricao; o servidor deixa o assistente reescrever esse titulo. */
export const DERIVED_TITLE_MAX = 80;

/** Titulo do chamado a partir do comeco da descricao, com espacos e quebras de linha juntados. */
export function deriveTitle(text: string): string {
  const flat = text.trim().replace(/\s+/g, ' ');
  if (flat.length <= DERIVED_TITLE_MAX) return flat;
  return `${flat.slice(0, DERIVED_TITLE_MAX - 1).trimEnd()}…`;
}

export function assistantGreeting(name: string, username: string): string {
  const who = username ? `, ${username}` : '';
  return `Olá${who}! Sou o ${name}, o assistente virtual do suporte. Descreva o problema: o que aconteceu, desde quando e se aparece alguma mensagem de erro. Eu abro o chamado e, se for um problema conhecido, já mando o passo a passo para resolver.`;
}
