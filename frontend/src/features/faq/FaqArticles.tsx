import { useState } from 'react';
import {
  Accordion,
  ActionIcon,
  Badge,
  Button,
  CopyButton,
  Grid,
  Group,
  Loader,
  NavLink,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconCheck, IconCopy, IconDeviceDesktop, IconFolder, IconMessageChatbot, IconPencil, IconSearch, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { faqApi } from '../../api/assistant';
import { queryKeys } from '../../api/queryKeys';
import type { FaqEntryDto, FaqOverviewDto, ListFaqParams } from '../../api/types';
import { LoadError } from '../../components/TableStates';
import { confirmAction, notifySuccess } from '../../lib/feedback';
import { formatRelative } from '../../lib/format';
import { GUIDE_TAG, usageLabel } from './faqFormat';

const FILTERS = [
  { value: 'todas', label: 'Todas as entradas' },
  { value: 'orientar', label: 'Orientam no chat' },
  { value: 'app', label: 'Visíveis no app EYES' },
  { value: 'equipe', label: 'Só para a equipe' },
];

/** Categoria escolhida na lateral: todas, uma pelo nome ou as sem categoria. */
type CategoryChoice = { kind: 'all' } | { kind: 'name'; name: string } | { kind: 'none' };

function listParams(clientId: number | undefined, search: string, category: CategoryChoice, filter: string): ListFaqParams {
  return {
    clientId,
    status: 'published',
    search: search || undefined,
    category: category.kind === 'name' ? category.name : undefined,
    uncategorized: category.kind === 'none' ? true : undefined,
    tag: filter === 'orientar' ? GUIDE_TAG : undefined,
    public: filter === 'app' ? true : filter === 'equipe' ? false : undefined,
  };
}

interface Props {
  clientId: number | undefined;
  canManage: boolean;
  overview: FaqOverviewDto | undefined;
  onEdit: (entry: FaqEntryDto) => void;
}

export function FaqArticles({ clientId, canManage, overview, onEdit }: Props) {
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search.trim(), 300);
  const [category, setCategory] = useState<CategoryChoice>({ kind: 'all' });
  const [filter, setFilter] = useState('todas');
  const params = listParams(clientId, debounced, category, filter);
  const entries = useQuery({ queryKey: queryKeys.faqList(params), queryFn: () => faqApi.list(params) });

  return (
    <Grid gap="lg">
      <Grid.Col span={{ base: 12, md: 3 }}>
        <Paper withBorder p={4} component="nav" aria-label="Categorias">
          <NavLink
            label="Todas"
            leftSection={<IconFolder size={16} />}
            rightSection={<CountBadge value={overview?.published} />}
            active={category.kind === 'all'}
            onClick={() => setCategory({ kind: 'all' })}
          />
          {overview?.categories.map((c) => (
            <NavLink
              key={c.name}
              label={c.name}
              leftSection={<IconFolder size={16} />}
              rightSection={<CountBadge value={c.count} />}
              active={category.kind === 'name' && category.name === c.name}
              onClick={() => setCategory({ kind: 'name', name: c.name })}
            />
          ))}
          {(overview?.uncategorized ?? 0) > 0 && (
            <NavLink
              label="Sem categoria"
              leftSection={<IconFolder size={16} />}
              rightSection={<CountBadge value={overview?.uncategorized} />}
              active={category.kind === 'none'}
              onClick={() => setCategory({ kind: 'none' })}
            />
          )}
        </Paper>
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 9 }}>
        <Group mb="sm" gap="sm" wrap="wrap">
          <TextInput
            placeholder="Procure pelo problema ou pela solução"
            aria-label="Buscar no FAQ"
            leftSection={<IconSearch size={16} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            style={{ flex: 1, minWidth: 220 }}
          />
          <Select aria-label="Filtrar entradas" data={FILTERS} value={filter} onChange={(v) => setFilter(v ?? 'todas')} allowDeselect={false} w={220} />
        </Group>
        {entries.isError && <LoadError error={entries.error} onRetry={() => void entries.refetch()} />}
        {entries.isPending && (
          <Group justify="center" py="xl">
            <Loader size="sm" aria-label="Carregando o FAQ" />
          </Group>
        )}
        {entries.data && entries.data.length === 0 && (
          <Paper withBorder p="xl">
            <Text c="dimmed" ta="center" size="sm">
              {debounced || category.kind !== 'all' || filter !== 'todas'
                ? 'Nenhuma entrada encontrada.'
                : 'O FAQ ainda está vazio. Cadastre os problemas conhecidos ou deixe o assistente sugerir entradas a partir dos chamados resolvidos.'}
            </Text>
          </Paper>
        )}
        {entries.data && entries.data.length > 0 && (
          <Accordion multiple variant="separated" chevronPosition="left">
            {entries.data.map((entry) => (
              <FaqArticle key={entry.id} entry={entry} canManage={canManage} onEdit={onEdit} />
            ))}
          </Accordion>
        )}
      </Grid.Col>
    </Grid>
  );
}

function CountBadge({ value }: { value: number | undefined }) {
  if (value === undefined) return null;
  return (
    <Badge size="sm" variant="light" color="gray" circle={value < 10}>
      {value}
    </Badge>
  );
}

function FaqArticle({ entry, canManage, onEdit }: { entry: FaqEntryDto; canManage: boolean; onEdit: (entry: FaqEntryDto) => void }) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => faqApi.remove(entry.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.faq });
      notifySuccess('Entrada do FAQ excluída.');
    },
  });

  return (
    <Accordion.Item value={String(entry.id)} opacity={entry.enabled ? 1 : 0.6}>
      <Accordion.Control>
        <Group gap={8} wrap="nowrap">
          <Text size="sm" fw={600} style={{ flex: 1 }}>
            {entry.question}
          </Text>
          {entry.guides && (
            <Tooltip label="O assistente envia este passo a passo ao usuário no chat">
              <IconMessageChatbot size={16} aria-label="Orienta o usuário" color="var(--mantine-color-teal-6)" />
            </Tooltip>
          )}
          {entry.public && (
            <Tooltip label="Aparece na ajuda do app EYES">
              <IconDeviceDesktop size={16} aria-label="Visível no app" color="var(--mantine-color-blue-6)" />
            </Tooltip>
          )}
          {!entry.enabled && (
            <Badge size="xs" variant="light" color="gray">
              Inativa
            </Badge>
          )}
          {entry.clientName && (
            <Badge size="xs" variant="outline" color="gray">
              {entry.clientName}
            </Badge>
          )}
        </Group>
      </Accordion.Control>
      <Accordion.Panel>
        <Stack gap="sm">
          <Text size="sm" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {entry.answer}
          </Text>
          <Group gap={4}>
            {entry.category && (
              <Badge size="sm" variant="light" color="indigo">
                {entry.category}
              </Badge>
            )}
            {entry.tags.map((tag) => (
              <Badge key={tag} size="sm" variant={tag === GUIDE_TAG ? 'filled' : 'light'} color={tag === GUIDE_TAG ? 'teal' : 'gray'}>
                {tag}
              </Badge>
            ))}
          </Group>
          <Group justify="space-between" wrap="wrap" gap="xs">
            <Stack gap={0}>
              <Text size="xs" c="dimmed">
                {usageLabel(entry)}
              </Text>
              <Text size="xs" c="dimmed">
                Atualizada {formatRelative(entry.updatedAt)} por {entry.updatedBy}
              </Text>
            </Stack>
            <Group gap={4} wrap="nowrap">
              <CopyButton value={entry.answer} timeout={1500}>
                {({ copied, copy }) => (
                  <Button size="xs" variant="subtle" leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />} onClick={copy}>
                    {copied ? 'Copiada' : 'Copiar resposta'}
                  </Button>
                )}
              </CopyButton>
              {canManage && (
                <>
                  <ActionIcon variant="subtle" aria-label={`Editar ${entry.question}`} onClick={() => onEdit(entry)}>
                    <IconPencil size={16} />
                  </ActionIcon>
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    aria-label={`Excluir ${entry.question}`}
                    onClick={() =>
                      confirmAction({
                        title: 'Excluir entrada do FAQ',
                        message: `Excluir "${entry.question}"? O assistente, os técnicos e os usuários do app deixam de ver esta solução.`,
                        confirmLabel: 'Excluir',
                        danger: true,
                        onConfirm: () => remove.mutate(),
                      })
                    }
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                </>
              )}
            </Group>
          </Group>
        </Stack>
      </Accordion.Panel>
    </Accordion.Item>
  );
}
