import { Anchor, Badge, Button, Group, Loader, Paper, Stack, Text } from '@mantine/core';
import { IconChecks, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { faqApi } from '../../api/assistant';
import { queryKeys } from '../../api/queryKeys';
import type { FaqEntryDto, ListFaqParams } from '../../api/types';
import { ticketPath } from '../../app/paths';
import { LoadError } from '../../components/TableStates';
import { confirmAction, notifySuccess } from '../../lib/feedback';
import { formatRelative } from '../../lib/format';
import { SOURCE_COLOR, SOURCE_LABEL } from './faqFormat';

interface Props {
  clientId: number | undefined;
  canManage: boolean;
  onReview: (entry: FaqEntryDto) => void;
}

/** Entradas sugeridas pelo assistente, por técnicos e pelos usuários do app, aguardando revisão. */
export function FaqSuggestions({ clientId, canManage, onReview }: Props) {
  const params: ListFaqParams = { clientId, status: 'proposed' };
  const entries = useQuery({ queryKey: queryKeys.faqList(params), queryFn: () => faqApi.list(params) });

  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        {canManage
          ? 'Revise o texto, ajuste a categoria e publique. Só as entradas publicadas valem para o assistente, para os técnicos e para a ajuda do app.'
          : 'Sugestões aguardando a revisão de quem edita a documentação.'}
      </Text>
      {entries.isError && <LoadError error={entries.error} onRetry={() => void entries.refetch()} />}
      {entries.isPending && (
        <Group justify="center" py="xl">
          <Loader size="sm" aria-label="Carregando as sugestões" />
        </Group>
      )}
      {entries.data && entries.data.length === 0 && (
        <Paper withBorder p="xl">
          <Text c="dimmed" ta="center" size="sm">
            Nenhuma sugestão aguardando revisão.
          </Text>
        </Paper>
      )}
      {entries.data?.map((entry) => (
        <Suggestion key={entry.id} entry={entry} canManage={canManage} onReview={onReview} />
      ))}
    </Stack>
  );
}

function Suggestion({ entry, canManage, onReview }: { entry: FaqEntryDto; canManage: boolean; onReview: (entry: FaqEntryDto) => void }) {
  const queryClient = useQueryClient();
  const discard = useMutation({
    mutationFn: () => faqApi.remove(entry.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.faq });
      notifySuccess('Sugestão descartada.');
    },
  });

  return (
    <Paper withBorder p="md" component="article" aria-label={entry.question}>
      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
        <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
          <Group gap={6}>
            <Badge size="sm" variant="light" color={SOURCE_COLOR[entry.source]}>
              {SOURCE_LABEL[entry.source]}
            </Badge>
            {entry.category && (
              <Badge size="sm" variant="light" color="indigo">
                {entry.category}
              </Badge>
            )}
            {entry.clientName && (
              <Badge size="sm" variant="outline" color="gray">
                {entry.clientName}
              </Badge>
            )}
          </Group>
          <Text fw={600}>{entry.question}</Text>
          {entry.answer ? (
            <Text size="sm" c="dimmed" lineClamp={4} style={{ whiteSpace: 'pre-wrap' }}>
              {entry.answer}
            </Text>
          ) : (
            <Text size="sm" c="dimmed" fs="italic">
              Sem resposta ainda.
            </Text>
          )}
          <Text size="xs" c="dimmed">
            Sugerida por {entry.suggestedBy ?? entry.updatedBy} {formatRelative(entry.createdAt)}
            {entry.sourceTicketId !== null && (
              <>
                {' · '}
                <Anchor component={Link} to={ticketPath(entry.sourceTicketId)} size="xs">
                  Chamado #{entry.sourceTicketId}
                </Anchor>
              </>
            )}
          </Text>
        </Stack>
        {canManage && (
          <Stack gap={6}>
            <Button size="xs" leftSection={<IconChecks size={14} />} onClick={() => onReview(entry)}>
              Revisar e publicar
            </Button>
            <Button
              size="xs"
              variant="subtle"
              color="red"
              leftSection={<IconTrash size={14} />}
              loading={discard.isPending}
              onClick={() =>
                confirmAction({
                  title: 'Descartar sugestão',
                  message: `Descartar "${entry.question}"?`,
                  confirmLabel: 'Descartar',
                  danger: true,
                  onConfirm: () => discard.mutate(),
                })
              }
            >
              Descartar
            </Button>
          </Stack>
        )}
      </Group>
    </Paper>
  );
}
