import { Alert, Code, Group, Text } from '@mantine/core';
import { IconBraces } from '@tabler/icons-react';
import { TEMPLATE_VARIABLES } from './scriptMeta';

export function TemplateVariablesHint({ context }: { context: string }) {
  return (
    <Alert variant="light" color="blue" icon={<IconBraces size={18} />} title="Variáveis disponíveis">
      <Text size="sm" mb="xs">
        Use estas variáveis {context}; elas são substituídas pelo servidor antes da execução.
      </Text>
      <Group gap="xs">
        {TEMPLATE_VARIABLES.map((v) => (
          <Text key={v.name} size="xs" span title={v.description}>
            <Code>{v.name}</Code> {v.description}
          </Text>
        ))}
      </Group>
    </Alert>
  );
}
