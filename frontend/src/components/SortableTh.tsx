import { Group, Table, Text, UnstyledButton } from '@mantine/core';
import { IconChevronDown, IconChevronUp, IconSelector } from '@tabler/icons-react';

export type SortDirection = 'asc' | 'desc';

export interface SortState<K extends string> {
  key: K;
  direction: SortDirection;
}

interface SortableThProps<K extends string> {
  label: string;
  column: K;
  sort: SortState<K>;
  onSort: (next: SortState<K>) => void;
  w?: number;
}

export function SortableTh<K extends string>({ label, column, sort, onSort, w }: SortableThProps<K>) {
  const active = sort.key === column;
  const Icon = active ? (sort.direction === 'asc' ? IconChevronUp : IconChevronDown) : IconSelector;
  const ariaSort = active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none';
  return (
    <Table.Th w={w} aria-sort={ariaSort}>
      <UnstyledButton
        onClick={() => onSort({ key: column, direction: active && sort.direction === 'asc' ? 'desc' : 'asc' })}
        aria-label={`Ordenar por ${label.toLowerCase()}`}
      >
        <Group gap={4} wrap="nowrap">
          <Text size="sm" fw={600}>
            {label}
          </Text>
          <Icon size={14} aria-hidden />
        </Group>
      </UnstyledButton>
    </Table.Th>
  );
}
