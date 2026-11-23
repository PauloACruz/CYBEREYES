import { useState } from 'react';
import { Anchor, Box, Button, Checkbox, Group, Menu, Paper, SegmentedControl, Stack, Table, Text, TextInput } from '@mantine/core';
import { IconChevronDown, IconPencil, IconSearch } from '@tabler/icons-react';
import { Link } from 'react-router';
import type { ProjectAgent, ProjectDetail, ProjectItemStatus } from '../../api/projects';
import { PERMISSIONS } from '../../api/types';
import { agentPath } from '../../app/paths';
import { hasPermission } from '../../auth/permissions';
import { useMe } from '../../auth/useMe';
import { EmptyRow } from '../../components/TableStates';
import { formatDateTime } from '../../lib/format';
import { ItemStatusBadge } from './ProjectBadges';
import { isFinished, ITEM_STATUS_OPTIONS } from './projectFormat';
import type { ProgressTarget } from './ProgressModal';

type Filter = 'all' | 'open' | 'finished' | 'problem';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'open', label: 'A fazer' },
  { value: 'finished', label: 'Encerradas' },
  { value: 'problem', label: 'Com problema' },
];

function matches(filter: Filter, status: ProjectItemStatus): boolean {
  if (filter === 'open') return !isFinished(status);
  if (filter === 'finished') return isFinished(status);
  if (filter === 'problem') return status === 'problem';
  return true;
}

const AGENT_COLOR: Record<string, string> = { online: 'teal', offline: 'gray', overdue: 'red' };

export function ProjectStations({ project, onRecord }: { project: ProjectDetail; onRecord: (target: ProgressTarget) => void }) {
  const { data: me } = useMe();
  const canOpenAgent = hasPermission(me, PERMISSIONS.agentsView);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const record = project.can.record;

  const term = search.trim().toLowerCase();
  const rows = project.agents.filter(
    (a) =>
      matches(filter, a.status) &&
      (!term || [a.hostname, a.clientName, a.siteName, a.description, a.note].some((v) => (v ?? '').toLowerCase().includes(term))),
  );
  const chosen = project.agents.filter((a) => selected.has(a.id));
  const allShown = rows.length > 0 && rows.every((a) => selected.has(a.id));
  const toggle = (row: ProjectAgent, checked: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(row.id);
      else next.delete(row.id);
      return next;
    });

  return (
    <Stack gap="sm">
      <Group justify="space-between" wrap="wrap" gap="sm">
        <Group gap="sm" wrap="wrap">
          <SegmentedControl size="xs" value={filter} onChange={(v) => setFilter(v)} data={FILTERS} />
          <TextInput
            size="xs"
            placeholder="Buscar estação"
            aria-label="Buscar estação"
            leftSection={<IconSearch size={14} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
        </Group>
        {record && (
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <Button size="xs" rightSection={<IconChevronDown size={14} />} disabled={chosen.length === 0}>
                Registrar {chosen.length > 0 ? `${chosen.length} ${chosen.length === 1 ? 'escolhida' : 'escolhidas'}` : 'escolhidas'}
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                onClick={() => {
                  onRecord({ kind: 'agents', rows: chosen });
                  setSelected(new Set());
                }}
              >
                Com situação e observação…
              </Menu.Item>
              <Menu.Divider />
              {ITEM_STATUS_OPTIONS.filter((o) => o.value === 'done' || o.value === 'skipped' || o.value === 'pending').map((o) => (
                <Menu.Item
                  key={o.value}
                  onClick={() => {
                    onRecord({ kind: 'agents', rows: chosen, status: o.value });
                    setSelected(new Set());
                  }}
                >
                  Marcar como “{o.label}”…
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
        )}
      </Group>
      <Paper withBorder>
        <Table.ScrollContainer minWidth={760}>
          <Table verticalSpacing="xs" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                {record && (
                  <Table.Th w={36}>
                    <Checkbox
                      aria-label="Escolher as estações listadas"
                      checked={allShown}
                      indeterminate={!allShown && rows.some((a) => selected.has(a.id))}
                      onChange={(e) => {
                        const checked = e.currentTarget.checked;
                        setSelected((prev) => {
                          const next = new Set(prev);
                          for (const a of rows) {
                            if (checked) next.add(a.id);
                            else next.delete(a.id);
                          }
                          return next;
                        });
                      }}
                    />
                  </Table.Th>
                )}
                <Table.Th>Estação</Table.Th>
                <Table.Th>Cliente e setor</Table.Th>
                <Table.Th>Situação</Table.Th>
                <Table.Th>Observação</Table.Th>
                <Table.Th>Registrado</Table.Th>
                {record && <Table.Th w={110} />}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.length === 0 && (
                <EmptyRow columns={record ? 7 : 5} message={project.agents.length === 0 ? 'Nenhuma estação neste projeto.' : 'Nenhuma estação neste filtro.'} />
              )}
              {rows.map((a) => (
                <Table.Tr key={a.id}>
                  {record && (
                    <Table.Td>
                      <Checkbox aria-label={`Escolher ${a.hostname}`} checked={selected.has(a.id)} onChange={(e) => toggle(a, e.currentTarget.checked)} />
                    </Table.Td>
                  )}
                  <Table.Td>
                    <Group gap={8} wrap="nowrap">
                      <Box
                        w={8}
                        h={8}
                        style={{ borderRadius: 4, flexShrink: 0 }}
                        bg={`var(--mantine-color-${a.agentStatus ? (AGENT_COLOR[a.agentStatus] ?? 'gray') : 'gray'}-6)`}
                        title={a.agentStatus ?? 'Agente removido'}
                      />
                      <Stack gap={0}>
                        {a.agentId !== null && canOpenAgent ? (
                          <Anchor component={Link} to={agentPath(a.agentId)} size="sm" fw={500}>
                            {a.hostname}
                          </Anchor>
                        ) : (
                          <Text size="sm" fw={500} td={a.agentId === null ? 'line-through' : undefined}>
                            {a.hostname}
                          </Text>
                        )}
                        {a.description && (
                          <Text size="xs" c="dimmed" lineClamp={1}>
                            {a.description}
                          </Text>
                        )}
                      </Stack>
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{[a.clientName, a.siteName].filter(Boolean).join(' / ') || '—'}</Text>
                  </Table.Td>
                  <Table.Td>
                    <ItemStatusBadge status={a.status} />
                  </Table.Td>
                  <Table.Td maw={280}>
                    <Text size="sm" lineClamp={2} title={a.note ?? undefined} style={{ whiteSpace: 'pre-wrap' }}>
                      {a.note ?? '—'}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    {a.doneAt ? (
                      <Stack gap={0}>
                        <Text size="sm">{a.doneByName}</Text>
                        <Text size="xs" c="dimmed">
                          {formatDateTime(a.doneAt)}
                        </Text>
                      </Stack>
                    ) : (
                      <Text size="sm" c="dimmed">
                        —
                      </Text>
                    )}
                  </Table.Td>
                  {record && (
                    <Table.Td>
                      <Button size="compact-xs" variant="light" leftSection={<IconPencil size={12} />} onClick={() => onRecord({ kind: 'agents', rows: [a] })}>
                        Registrar
                      </Button>
                    </Table.Td>
                  )}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
    </Stack>
  );
}
