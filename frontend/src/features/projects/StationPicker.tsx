import { useMemo, useState } from 'react';
import { Box, Button, Checkbox, Group, Paper, ScrollArea, Stack, Text, TextInput } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import type { ProjectOptionAgent, ProjectOptionClient } from '../../api/projects';

interface Props {
  agents: ProjectOptionAgent[];
  clients: ProjectOptionClient[];
  /** Clientes e setores escolhidos: restringem as estações listadas (setores valem mais que clientes). */
  clientIds: number[];
  siteIds: number[];
  value: number[];
  onChange: (ids: number[]) => void;
  error?: string;
}

const STATUS_COLOR: Record<string, string> = { online: 'teal', offline: 'gray', overdue: 'red' };

/** Lista das estações com marcação, filtrada pelos clientes/setores escolhidos e pela busca. */
export function StationPicker({ agents, clients, clientIds, siteIds, value, onChange, error }: Props) {
  const [search, setSearch] = useState('');
  const selected = useMemo(() => new Set(value), [value]);
  const names = useMemo(() => {
    const client = new Map<number, string>();
    const site = new Map<number, string>();
    for (const c of clients) {
      client.set(c.id, c.name);
      for (const s of c.sites) site.set(s.id, s.name);
    }
    return { client, site };
  }, [clients]);

  const term = search.trim().toLowerCase();
  const scoped = agents.filter((a) =>
    siteIds.length > 0 ? siteIds.includes(a.siteId) : clientIds.length > 0 ? clientIds.includes(a.clientId) : true,
  );
  const visible = term
    ? scoped.filter((a) => a.hostname.toLowerCase().includes(term) || (a.description ?? '').toLowerCase().includes(term))
    : scoped;
  const outside = value.filter((id) => !scoped.some((a) => a.id === id)).length;
  const allVisibleSelected = visible.length > 0 && visible.every((a) => selected.has(a.id));

  const toggle = (id: number, checked: boolean) => onChange(checked ? [...value, id] : value.filter((x) => x !== id));
  const selectVisible = () => onChange([...new Set([...value, ...visible.map((a) => a.id)])]);
  const clearVisible = () => onChange(value.filter((id) => !visible.some((a) => a.id === id)));

  const scopeText =
    siteIds.length > 0
      ? 'Estações dos setores escolhidos'
      : clientIds.length > 0
        ? 'Estações dos clientes escolhidos'
        : 'Todas as estações (escolha clientes ou setores para filtrar)';

  return (
    <Stack gap={6}>
      <Group justify="space-between" align="flex-end" wrap="wrap" gap="xs">
        <div>
          <Text size="sm" fw={500}>
            Estações
          </Text>
          <Text size="xs" c="dimmed">
            {scopeText}. {value.length} {value.length === 1 ? 'escolhida' : 'escolhidas'}
            {outside > 0 && ` (${outside} fora do filtro atual)`}.
          </Text>
        </div>
        <Group gap="xs">
          <TextInput
            size="xs"
            placeholder="Buscar estação"
            aria-label="Buscar estação"
            leftSection={<IconSearch size={14} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
          <Button size="xs" variant="light" onClick={allVisibleSelected ? clearVisible : selectVisible} disabled={visible.length === 0}>
            {allVisibleSelected ? 'Desmarcar as listadas' : `Marcar as listadas (${visible.length})`}
          </Button>
        </Group>
      </Group>
      <Paper withBorder style={error ? { borderColor: 'var(--mantine-color-error)' } : undefined}>
        <ScrollArea.Autosize mah={260} type="auto">
          {visible.length === 0 ? (
            <Text size="sm" c="dimmed" ta="center" py="md">
              Nenhuma estação.
            </Text>
          ) : (
            <Stack gap={0}>
              {visible.map((a) => (
                <Box key={a.id} px="sm" py={6} style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
                  <Checkbox
                    checked={selected.has(a.id)}
                    onChange={(e) => toggle(a.id, e.currentTarget.checked)}
                    label={
                      <Group gap={8} wrap="nowrap">
                        <Box w={8} h={8} style={{ borderRadius: 4, flexShrink: 0 }} bg={`var(--mantine-color-${STATUS_COLOR[a.status] ?? 'gray'}-6)`} aria-hidden />
                        <Text size="sm" fw={500}>
                          {a.hostname}
                        </Text>
                        <Text size="xs" c="dimmed" lineClamp={1}>
                          {[names.client.get(a.clientId), names.site.get(a.siteId), a.description].filter(Boolean).join(' · ')}
                        </Text>
                      </Group>
                    }
                  />
                </Box>
              ))}
            </Stack>
          )}
        </ScrollArea.Autosize>
      </Paper>
      {error && (
        <Text size="xs" c="red">
          {error}
        </Text>
      )}
    </Stack>
  );
}
