/** Conteineres flutuantes do app: os mesmos do console (cantos de 15px, borda sutil e sombra). */
export const MOBILE_FLOATING = {
  backgroundColor: 'var(--ce-bg-surface)',
  border: '1px solid var(--ce-border-subtle)',
  borderRadius: 15,
  boxShadow: 'var(--ce-shadow-md)',
} as const;

/** Cartao de conteudo do app (cantos de 8px). */
export const MOBILE_CARD = {
  backgroundColor: 'var(--ce-bg-surface)',
  border: '1px solid var(--ce-border-subtle)',
  borderRadius: 8,
} as const;
