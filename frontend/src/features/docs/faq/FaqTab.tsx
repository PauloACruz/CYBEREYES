import { useState } from 'react';
import { ActionIcon, Badge, Button, Group, Paper, Select, Spoiler, Table, Text, TextInput, Tooltip } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconMessageChatbot, IconPencil, IconPlus, IconSearch, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { faqApi } from '../../../api/assistant';
import { queryKeys } from '../../../api/queryKeys';
import type { FaqEntryDto } from '../../../api/types';
import { EmptyRow, LoadError, LoadingRows } from '../../../components/TableStates';
import { confirmAction, notifySuccess } from '../../../lib/feedback';
import { RelativeTime } from '../../agents/agentDisplay';
import { FaqFormModal, GUIDE_TAG } from './FaqFormModal';

const FILTERS = [
  { value: 'todas', label: 'Todas as entradas' },
  { value: GUIDE_TAG, label: 'Com a tag orientar' },
];

export function FaqTab({ clientId, canManage }: { clientId: number | undefined; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search.trim(), 300);
  const [filter, setFilter] = useState('todas');
  const [editing, setEditing] = useState<FaqEntryDto | null>(null);
  const [opened, setOpened] = useState(false);
  const params = { clientId, search: debounced || undefined, tag: filter === GUIDE_TAG ? GUIDE_TAG : undefined };
  const entries = useQuery({ queryKey: queryKeys.faqList(params), queryFn: () => faqApi.list(params) });
  const columns = canManage ? 5 : 4;

  const remove = useMutation({
    mutationFn: (id: number) => faqApi.remove(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.faq });
      notifySuccess('Entrada do FAQ excluída.');
    },
  });

  const open = (entry: FaqEntryDto | null) => {
    setEditing(entry);
    setOpened(true);
  };

  return (
    <>
      <Text size="sm" c="dimmed" mb="sm">
        Problemas conhecidos e como resolver. As entradas com a tag orientar são enviadas pelo assistente de IA ao usuário no chat do app EYES;
        as demais ajudam a equipe.
      </Text>
      <Group justify="space-between" mb="sm" wrap="wrap">
        <Group gap="sm">
          <TextInput
            placeholder="Problema ou resposta"
            aria-label="Buscar no FAQ"
            leftSection={<IconSearch size={16} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            w={260}
          />
          <Select aria-label="Filtrar entradas" data={FILTERS} value={filter} onChange={(v) => setFilter(v ?? 'todas')} allowDeselect={false} w={220} />
        </Group>
        {canManage && (
          <Button leftSection={<IconPlus size={16} />} onClick={() => open(null)}>
            Nova entrada
          </Button>
        )}
      </Group>
      {entries.isError && <LoadError error={entries.error} onRetry={() => void entries.refetch()} />}
      <Paper withBorder>
        <Table.ScrollContainer minWidth={720}>
          <Table verticalSpacing="xs" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Problema e resposta</Table.Th>
                <Table.Th w={200}>Tags</Table.Th>
                <Table.Th w={160}>Cliente</Table.Th>
                <Table.Th w={170}>Atualizada</Table.Th>
                {canManage && <Table.Th w={90} aria-label="Ações" />}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {entries.isPending && <LoadingRows columns={columns} />}
              {entries.data && entries.data.length === 0 && <EmptyRow columns={columns} message="Nenhuma entrada no FAQ." />}
              {entries.data?.map((entry) => (
                <Table.Tr key={entry.id} opacity={entry.enabled ? 1 : 0.55}>
                  <Table.Td>
                    <Group gap={6} wrap="nowrap">
                      {entry.guides && (
                        <Tooltip label="O assistente envia este passo a passo ao usuário">
                          <IconMessageChatbot size={16} aria-label="Orienta o usuário" color="var(--mantine-color-teal-6)" />
                        </Tooltip>
                      )}
                      <Text size="sm" fw={600}>
                        {entry.question}
                      </Text>
                      {!entry.enabled && (
                        <Badge size="xs" variant="light" color="gray">
                          Inativa
                        </Badge>
                      )}
                    </Group>
                    <Spoiler maxHeight={44} showLabel="Ver mais" hideLabel="Ver menos">
                      <Text size="sm" c="dimmed" style={{ whiteSpace: 'pre-wrap' }}>
                        {entry.answer}
                      </Text>
                    </Spoiler>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4}>
                      {entry.tags.map((tag) => (
                        <Badge key={tag} size="sm" variant={tag === GUIDE_TAG ? 'filled' : 'light'} color={tag === GUIDE_TAG ? 'teal' : 'gray'}>
                          {tag}
                        </Badge>
                      ))}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{entry.clientName ?? 'Todos'}</Text>
                  </Table.Td>
                  <Table.Td>
                    <RelativeTime value={entry.updatedAt} />
                    <Text size="xs" c="dimmed">
                      por {entry.updatedBy}
                    </Text>
                  </Table.Td>
                  {canManage && (
                    <Table.Td>
                      <Group gap={4} wrap="nowrap">
                        <ActionIcon variant="subtle" aria-label={`Editar ${entry.question}`} onClick={() => open(entry)}>
                          <IconPencil size={16} />
                        </ActionIcon>
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          aria-label={`Excluir ${entry.question}`}
                          onClick={() =>
                            confirmAction({
                              title: 'Excluir entrada do FAQ',
                              message: `Excluir "${entry.question}"? O assistente deixa de usar esta solução.`,
                              confirmLabel: 'Excluir',
                              danger: true,
                              onConfirm: () => remove.mutate(entry.id),
                            })
                          }
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Group>
                    </Table.Td>
                  )}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
      <FaqFormModal opened={opened} onClose={() => setOpened(false)} entry={editing} defaultClientId={clientId} />
    </>
  );
}
