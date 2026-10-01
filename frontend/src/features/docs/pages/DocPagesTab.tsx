import { useState } from 'react';
import { Anchor, Button, Group, Paper, Table, Text, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconPlus, IconSearch } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { docPagesApi } from '../../../api/docs';
import { queryKeys } from '../../../api/queryKeys';
import { docPagePath, PATHS } from '../../../app/paths';
import { EmptyRow, LoadError, LoadingRows } from '../../../components/TableStates';
import { RelativeTime } from '../../agents/agentDisplay';

const COLUMNS = 3;

export function DocPagesTab({ clientId, canManage }: { clientId: number | undefined; canManage: boolean }) {
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search.trim(), 300);
  const pages = useQuery({
    queryKey: queryKeys.docPageList(clientId, debounced),
    queryFn: () => docPagesApi.list({ clientId, search: debounced || undefined }),
  });
  const newPath = clientId ? `${PATHS.newDocPage}?cliente=${clientId}` : PATHS.newDocPage;

  return (
    <>
      <Group justify="space-between" mb="sm" wrap="wrap">
        <TextInput
          placeholder="Título ou conteúdo"
          aria-label="Buscar páginas"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          w={280}
        />
        {canManage && (
          <Button component={Link} to={newPath} leftSection={<IconPlus size={16} />}>
            Nova página
          </Button>
        )}
      </Group>
      {pages.isError && <LoadError error={pages.error} onRetry={() => void pages.refetch()} />}
      <Paper withBorder>
        <Table.ScrollContainer minWidth={640}>
          <Table verticalSpacing="xs" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Título</Table.Th>
                <Table.Th w={200}>Cliente</Table.Th>
                <Table.Th w={200}>Atualizada</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {pages.isPending && <LoadingRows columns={COLUMNS} />}
              {pages.data && pages.data.length === 0 && <EmptyRow columns={COLUMNS} message="Nenhuma página de documentação." />}
              {pages.data?.map((page) => (
                <Table.Tr key={page.id}>
                  <Table.Td>
                    <Anchor component={Link} to={docPagePath(page.id)} size="sm" fw={600}>
                      {page.title}
                    </Anchor>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{page.clientName ?? ''}</Text>
                  </Table.Td>
                  <Table.Td>
                    <RelativeTime value={page.updatedAt} />
                    <Text size="xs" c="dimmed">
                      por {page.updatedBy}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
    </>
  );
}
