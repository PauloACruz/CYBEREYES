import { useState } from 'react';
import { Badge, Group, Pagination, Paper, SimpleGrid, Table, Text, TextInput } from '@mantine/core';
import { DatePickerInput, type DatesRangeValue } from '@mantine/dates';
import { useDebouncedValue } from '@mantine/hooks';
import { IconCalendar, IconSearch, IconUser } from '@tabler/icons-react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { auditApi } from '../../api/audit';
import type { ListAuditParams } from '../../api/types';
import { PageHeader } from '../../components/PageHeader';
import { EmptyRow, LoadError, LoadingRows } from '../../components/TableStates';
import { formatDateTime, totalPages } from '../../lib/format';

const PAGE_SIZE = 50;
const COLUMNS = 6;

type Range = DatesRangeValue<string>;

export function AuditPage() {
  const [page, setPage] = useState(1);
  const [username, setUsername] = useState('');
  const [action, setAction] = useState('');
  const [range, setRange] = useState<Range>([null, null]);
  const [debounced] = useDebouncedValue({ username: username.trim(), action: action.trim() }, 300);

  const [from, to] = range;
  const params: ListAuditParams = {
    page,
    pageSize: PAGE_SIZE,
    username: debounced.username || undefined,
    action: debounced.action || undefined,
    from: from ? dayjs(from).startOf('day').toISOString() : undefined,
    to: to ? dayjs(to).endOf('day').toISOString() : undefined,
  };
  const audit = useQuery({
    queryKey: ['audit', params],
    queryFn: () => auditApi.list(params),
    placeholderData: keepPreviousData,
  });

  const hasFilters = Boolean(params.username ?? params.action ?? params.from ?? params.to);
  const rows = audit.data?.items ?? [];

  return (
    <>
      <PageHeader title="Auditoria" description="Registro das ações realizadas no console e pela API." />
      <SimpleGrid cols={{ base: 1, sm: 3 }} mb="md">
        <TextInput
          label="Usuário"
          placeholder="Qualquer usuário"
          leftSection={<IconUser size={16} />}
          value={username}
          onChange={(e) => {
            setUsername(e.currentTarget.value);
            setPage(1);
          }}
        />
        <TextInput
          label="Ação"
          placeholder="Ex.: user.create"
          leftSection={<IconSearch size={16} />}
          value={action}
          onChange={(e) => {
            setAction(e.currentTarget.value);
            setPage(1);
          }}
        />
        <DatePickerInput
          type="range"
          label="Período"
          placeholder="Qualquer data"
          valueFormat="DD/MM/YYYY"
          leftSection={<IconCalendar size={16} />}
          clearable
          allowSingleDateInRange
          maxDate={dayjs().format('YYYY-MM-DD')}
          value={range}
          onChange={(value) => {
            setRange(value);
            setPage(1);
          }}
        />
      </SimpleGrid>
      {audit.isError && <LoadError error={audit.error} onRetry={() => void audit.refetch()} />}
      <Paper withBorder>
        <Table.ScrollContainer minWidth={900}>
          <Table striped highlightOnHover verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={150}>Data e hora</Table.Th>
                <Table.Th>Usuário</Table.Th>
                <Table.Th>Ação</Table.Th>
                <Table.Th>Objeto</Table.Th>
                <Table.Th>Mensagem</Table.Th>
                <Table.Th>IP</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {audit.isPending && <LoadingRows columns={COLUMNS} />}
              {audit.isSuccess && rows.length === 0 && (
                <EmptyRow columns={COLUMNS} message={hasFilters ? 'Nenhum registro encontrado com estes filtros.' : 'Nenhum registro de auditoria.'} />
              )}
              {rows.map((entry) => (
                <Table.Tr key={entry.id}>
                  <Table.Td>
                    <Text size="sm" style={{ whiteSpace: 'nowrap' }}>
                      {formatDateTime(entry.timestamp, '')}
                    </Text>
                  </Table.Td>
                  <Table.Td>{entry.username ?? <Text size="sm" c="dimmed">Sistema</Text>}</Table.Td>
                  <Table.Td>
                    <Badge variant="light" color="gray" size="sm" tt="none">
                      {entry.action}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">
                      {entry.objectType ?? ''}
                      {entry.objectId ? ` #${entry.objectId}` : ''}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" lineClamp={2}>
                      {entry.message ?? ''}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" ff="monospace">
                      {entry.ipAddress ?? ''}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
      {audit.data && (
        <Group justify="space-between" mt="md">
          <Text size="sm" c="dimmed">
            {audit.data.total} {audit.data.total === 1 ? 'registro' : 'registros'}
          </Text>
          <Pagination total={totalPages(audit.data.total, PAGE_SIZE)} value={page} onChange={setPage} size="sm" />
        </Group>
      )}
    </>
  );
}
