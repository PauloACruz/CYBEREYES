import { useState } from 'react';
import { Badge, Button, Group, Loader, Modal, Paper, ScrollArea, Stack, Text, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconHelpCircle, IconSearch } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { faqApi } from '../../api/assistant';
import { queryKeys } from '../../api/queryKeys';
import type { FaqEntryDto, ListFaqParams } from '../../api/types';
import { LoadError } from '../../components/TableStates';

interface Props {
  /** Cliente do chamado: mostra as entradas gerais e as dele. */
  clientId: number | null | undefined;
  onInsert: (answer: string) => void;
}

/** Botão da resposta do chamado que procura no FAQ e insere a resposta de uma entrada publicada. */
export function FaqPickerButton({ clientId, onInsert }: Props) {
  const [opened, setOpened] = useState(false);
  return (
    <>
      <Button variant="default" leftSection={<IconHelpCircle size={16} />} onClick={() => setOpened(true)}>
        Inserir do FAQ
      </Button>
      <Modal opened={opened} onClose={() => setOpened(false)} title="Inserir resposta do FAQ" size="lg">
        {opened && (
          <FaqPicker
            clientId={clientId}
            onPick={(entry) => {
              onInsert(entry.answer);
              void faqApi.used(entry.id).catch(() => undefined);
              setOpened(false);
            }}
          />
        )}
      </Modal>
    </>
  );
}

function FaqPicker({ clientId, onPick }: { clientId: number | null | undefined; onPick: (entry: FaqEntryDto) => void }) {
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search.trim(), 300);
  const params: ListFaqParams = { clientId: clientId ?? undefined, status: 'published', search: debounced || undefined };
  const entries = useQuery({ queryKey: queryKeys.faqList(params), queryFn: () => faqApi.list(params) });
  const active = entries.data?.filter((e) => e.enabled);

  return (
    <Stack gap="sm">
      <TextInput
        placeholder="Procure pelo problema ou pela solução"
        aria-label="Buscar no FAQ"
        leftSection={<IconSearch size={16} />}
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
        data-autofocus
      />
      {entries.isError && <LoadError error={entries.error} onRetry={() => void entries.refetch()} />}
      {entries.isPending && (
        <Group justify="center" py="md">
          <Loader size="sm" aria-label="Carregando o FAQ" />
        </Group>
      )}
      {active && active.length === 0 && (
        <Text size="sm" c="dimmed" ta="center" py="md">
          Nenhuma entrada publicada encontrada.
        </Text>
      )}
      {active && active.length > 0 && (
        <ScrollArea.Autosize mah={420}>
          <Stack gap="xs" pr="xs">
            {active.map((entry) => (
              <Paper key={entry.id} withBorder p="sm">
                <Group justify="space-between" wrap="nowrap" align="flex-start">
                  <Stack gap={4} style={{ minWidth: 0 }}>
                    <Group gap={6}>
                      <Text size="sm" fw={600}>
                        {entry.question}
                      </Text>
                      {entry.category && (
                        <Badge size="xs" variant="light" color="indigo">
                          {entry.category}
                        </Badge>
                      )}
                    </Group>
                    <Text size="xs" c="dimmed" lineClamp={2}>
                      {entry.answer}
                    </Text>
                  </Stack>
                  <Button size="xs" variant="light" onClick={() => onPick(entry)} aria-label={`Inserir ${entry.question}`}>
                    Inserir
                  </Button>
                </Group>
              </Paper>
            ))}
          </Stack>
        </ScrollArea.Autosize>
      )}
    </Stack>
  );
}
