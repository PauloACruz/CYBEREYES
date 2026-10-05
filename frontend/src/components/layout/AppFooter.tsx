import { Code, Group, Text } from '@mantine/core';

/** Rodape do console: copyright da PCruzTI e o commit do codigo publicado. */
export function AppFooter() {
  return (
    <Group
      component="footer"
      justify="space-between"
      wrap="nowrap"
      gap="md"
      h={40}
      px={20}
      style={{
        backgroundColor: 'var(--ce-bg-surface)',
        border: '1px solid var(--ce-border-subtle)',
        borderRadius: 15,
        boxShadow: 'var(--ce-shadow-md)',
      }}
    >
      <Text fz={12} lh="16px" c="var(--ce-text-tertiary)" truncate>
        © {new Date().getFullYear()} PCruzTI. Todos os direitos reservados.
      </Text>
      <Group gap={6} wrap="nowrap">
        <Text fz={12} lh="16px" c="var(--ce-text-tertiary)">
          Versão
        </Text>
        <Code title="Commit do código publicado" fz={12} c="var(--ce-text-secondary)">
          {__APP_COMMIT__}
        </Code>
      </Group>
    </Group>
  );
}
