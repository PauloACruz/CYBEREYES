import { Text, Typography } from '@mantine/core';
import Markdown, { type Components } from 'react-markdown';

// Links do usuario abrem em nova aba sem acesso a janela de origem.
const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow">
      {children}
    </a>
  ),
};

/** Renderiza Markdown sem interpretar HTML bruto: tags digitadas pelo usuario sao descartadas. */
export function MarkdownView({ body }: { body: string }) {
  if (!body.trim()) {
    return (
      <Text size="sm" c="dimmed">
        Página sem conteúdo.
      </Text>
    );
  }
  return (
    <Typography>
      <Markdown skipHtml components={components}>
        {body}
      </Markdown>
    </Typography>
  );
}
