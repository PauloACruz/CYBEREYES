import { useState } from 'react';
import { Anchor, Button, Group, Paper, SegmentedControl, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconPackage, IconSearch } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { softwareApi } from '../../../api/monitoring';
import { queryKeys } from '../../../api/queryKeys';
import type { AgentDetail, CatalogPackage, PackageManager } from '../../../api/types';
import { ApiErrorAlert } from '../../../components/ApiErrorAlert';
import { EmptyRow, LoadError, LoadingRows } from '../../../components/TableStates';
import { confirmAction, notifySuccess } from '../../../lib/feedback';
import { MANAGER_LABEL } from './packageManagers';


// O servidor aceita de 2 a 60 letras, numeros, espaco e . _ + - na pesquisa.
const TERM_PATTERN = /^[\p{L}\p{N} ._+-]{2,60}$/u;

// Identificador digitado para instalar sem pesquisar (o mesmo que o servidor valida).
const ID_PATTERN: Record<PackageManager, RegExp> = {
  choco: /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/,
  winget: /^[A-Za-z0-9][A-Za-z0-9_.+-]{0,127}$/,
};

const COLUMNS = 4;

function downloads(n: number | null): string {
  if (n === null) return '';
  return `${new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(n)} downloads`;
}

/** Pesquisa no Chocolatey ou no winget e instala o pacote escolhido no agente Windows. */
export function PackageInstall({ agent }: { agent: AgentDetail }) {
  const queryClient = useQueryClient();
  const [manager, setManager] = useState<PackageManager>('choco');
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search.trim(), 400);
  const searchable = TERM_PATTERN.test(debounced);

  const results = useQuery({
    queryKey: queryKeys.softwareCatalog(manager, debounced.toLowerCase()),
    queryFn: () => softwareApi.catalog(manager, debounced),
    enabled: searchable,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const install = useMutation({
    mutationFn: ({ id }: { id: string; name: string }) => softwareApi.install(agent.id, id, manager),
    onSuccess: (_, { name }) => {
      notifySuccess(`A instalação de ${name} pelo ${MANAGER_LABEL[manager]} foi enviada ao agente.`, 'Instalação solicitada');
      void queryClient.invalidateQueries({ queryKey: queryKeys.agentPendingActions(agent.id) });
    },
  });

  const confirm = (id: string, name: string) => {
    confirmAction({
      title: 'Instalar software',
      message: `Instalar ${name === id ? id : `${name} (${id})`} pelo ${MANAGER_LABEL[manager]} em ${agent.hostname}?`,
      confirmLabel: 'Instalar',
      onConfirm: () => install.mutate({ id, name }),
    });
  };

  const items = results.data?.items ?? [];
  const typed = search.trim();
  const exactOffered = ID_PATTERN[manager].test(typed) && !items.some((i) => i.id.toLowerCase() === typed.toLowerCase());

  return (
    <Paper withBorder p="md">
      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap">
          <Group gap="xs">
            <IconPackage size={18} aria-hidden />
            <Title order={4}>Instalar software</Title>
          </Group>
          <SegmentedControl
            aria-label="Gerenciador de pacotes"
            value={manager}
            onChange={setManager}
            data={[
              { value: 'choco', label: 'Chocolatey' },
              { value: 'winget', label: 'winget' },
            ]}
          />
        </Group>
        <TextInput
          label={`Pesquisar no ${MANAGER_LABEL[manager]}`}
          placeholder={manager === 'choco' ? 'chrome, 7zip, vlc...' : 'Google Chrome, 7zip, Notepad++...'}
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          error={typed.length >= 2 && !TERM_PATTERN.test(typed) ? 'Use letras, números, espaço ou . _ + -' : undefined}
          maw={480}
        />
        {install.isError && <ApiErrorAlert error={install.error} />}
        {results.isError && <LoadError error={results.error} onRetry={() => void results.refetch()} />}
        {searchable && !results.isError && (
          <Table.ScrollContainer minWidth={600}>
            <Table verticalSpacing="xs" aria-label={`Pacotes do ${MANAGER_LABEL[manager]}`}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Pacote</Table.Th>
                  <Table.Th w={150}>Versão</Table.Th>
                  <Table.Th w={150}>{manager === 'choco' ? 'Popularidade' : ''}</Table.Th>
                  <Table.Th w={110} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {results.isPending && <LoadingRows columns={COLUMNS} rows={3} />}
                {results.isSuccess && items.length === 0 && <EmptyRow columns={COLUMNS} message="Nenhum pacote encontrado." />}
                {items.map((item: CatalogPackage) => (
                  <Table.Tr key={item.id}>
                    <Table.Td>
                      <Text fw={500} size="sm">
                        {item.name}
                      </Text>
                      <Text size="xs" c="dimmed" ff="monospace">
                        {item.id}
                      </Text>
                      {item.summary && (
                        <Text size="xs" c="dimmed" lineClamp={2}>
                          {item.summary}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{item.version}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c="dimmed">
                        {downloads(item.downloads)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Button size="xs" variant="light" onClick={() => confirm(item.id, item.name)} aria-label={`Instalar ${item.name}`}>
                        Instalar
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        {exactOffered && (
          <Text size="sm" c="dimmed">
            Sabe o identificador exato?{' '}
            <Anchor component="button" type="button" size="sm" onClick={() => confirm(typed, typed)}>
              Instalar {typed} pelo {MANAGER_LABEL[manager]}
            </Anchor>
          </Text>
        )}
        {manager === 'winget' && (
          <Text size="xs" c="dimmed">
            O winget precisa do App Installer da Microsoft (Windows 10 1809 ou mais novo). A instalação é feita para todos os
            usuários quando o pacote permite.
          </Text>
        )}
      </Stack>
    </Paper>
  );
}
