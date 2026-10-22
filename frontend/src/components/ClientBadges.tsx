import { Badge, Group, Text, Tooltip } from '@mantine/core';
import type { ClientRef } from '../api/types';

const CLIENTS_SHOWN = 2;

/** Clientes liberados a um usuário ou papel; `null` quando ele vê todos. */
export function ClientBadges({ clients }: { clients: ClientRef[] | null }) {
  if (clients === null) {
    return (
      <Text size="sm" c="dimmed">
        Todos
      </Text>
    );
  }
  const extra = clients.slice(CLIENTS_SHOWN);
  return (
    <Group gap={4}>
      {clients.slice(0, CLIENTS_SHOWN).map((c) => (
        <Badge key={c.id} variant="outline" size="sm">
          {c.name}
        </Badge>
      ))}
      {extra.length > 0 && (
        <Tooltip label={extra.map((c) => c.name).join(', ')} withArrow multiline maw={320}>
          <Badge variant="outline" color="gray" size="sm">
            +{extra.length}
          </Badge>
        </Tooltip>
      )}
    </Group>
  );
}
