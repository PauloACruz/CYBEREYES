import { Button, Checkbox, Fieldset, Group, SimpleGrid, Stack, Text } from '@mantine/core';
import type { PermissionDto } from '../../api/types';

function groupPermissions(permissions: PermissionDto[]): [string, PermissionDto[]][] {
  const groups = new Map<string, PermissionDto[]>();
  for (const p of permissions) {
    const list = groups.get(p.group);
    if (list) list.push(p);
    else groups.set(p.group, [p]);
  }
  return [...groups.entries()];
}

const isReadOnly = (key: string) => key.endsWith('.view');

interface AgentPermissionsProps {
  /** "agente nativo" ou "agente da Anthropic", para os textos e o rótulo da lista. */
  agent: string;
  catalog: PermissionDto[];
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}

/** Lista completa de permissões da plataforma para liberar ou limitar o que um agente de IA faz no console. */
export function AgentPermissions({ agent, catalog, value, onChange, disabled }: AgentPermissionsProps) {
  const known = value.filter((p) => catalog.some((c) => c.key === p));
  return (
    <Stack gap="sm">
      <Group justify="space-between" wrap="wrap">
        <Text size="sm" c="dimmed">
          {known.length} de {catalog.length} permissões liberadas para o {agent}.
        </Text>
        <Group gap="xs">
          <Button size="compact-sm" variant="default" disabled={disabled} onClick={() => onChange(catalog.filter((p) => isReadOnly(p.key)).map((p) => p.key))}>
            Só leitura
          </Button>
          <Button size="compact-sm" variant="default" disabled={disabled} onClick={() => onChange(catalog.map((p) => p.key))}>
            Todas
          </Button>
          <Button size="compact-sm" variant="default" disabled={disabled} onClick={() => onChange([])}>
            Nenhuma
          </Button>
        </Group>
      </Group>
      <Checkbox.Group value={known} onChange={onChange}>
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} role="group" aria-label={`Permissões do ${agent}`}>
          {groupPermissions(catalog).map(([group, items]) => (
            <Fieldset key={group} legend={group} variant="filled" disabled={disabled}>
              <Stack gap={6}>
                {items.map((p) => (
                  <Checkbox key={p.key} value={p.key} label={p.description} description={p.key} size="xs" />
                ))}
              </Stack>
            </Fieldset>
          ))}
        </SimpleGrid>
      </Checkbox.Group>
    </Stack>
  );
}
