import { ActionIcon, Anchor, Breadcrumbs, Button, FileButton, Group, Menu, Modal, Paper, Progress, Stack, Switch, Table, Text, TextInput, Tooltip } from '@mantine/core';
import {
  IconArrowUp,
  IconDots,
  IconDownload,
  IconFile,
  IconFolder,
  IconFolderPlus,
  IconHome,
  IconPencil,
  IconRefresh,
  IconTrash,
  IconUpload,
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type DragEvent, type SyntheticEvent } from 'react';
import { ApiError } from '../../api/client';
import { remoteFilesApi } from '../../api/remote';
import type { RemoteFileEntry } from '../../api/types';
import { EmptyRow, LoadError, LoadingRows } from '../../components/TableStates';
import { formatBytes, formatDateTime } from '../../lib/format';
import { joinPath, parentPath, pathCrumbs } from './uploads';
import type { Transfer, useTransfers } from './useTransfers';

type TransfersApi = ReturnType<typeof useTransfers>;

function TransferList({ transfers, onClear }: { transfers: Transfer[]; onClear: () => void }) {
  if (transfers.length === 0) return null;
  return (
    <Stack gap={6} mt="sm" aria-label="Transferências">
      <Group justify="space-between">
        <Text size="sm" fw={600}>
          Transferências
        </Text>
        <Button size="compact-xs" variant="subtle" onClick={onClear}>
          Limpar concluídas
        </Button>
      </Group>
      {transfers.map((t) => (
        <div key={t.id}>
          <Group justify="space-between" gap="xs" wrap="nowrap">
            <Text size="xs" truncate>
              {t.name}
            </Text>
            <Text size="xs" c={t.status === 'failed' ? 'red' : 'dimmed'}>
              {t.status === 'done' ? 'Enviado' : t.status === 'failed' ? (t.error ?? 'Falhou') : t.status === 'waiting' ? 'Na fila' : `${formatBytes(t.sent)} de ${formatBytes(t.total)}`}
            </Text>
          </Group>
          <Progress
            size="xs"
            value={t.total > 0 ? (t.sent / t.total) * 100 : t.status === 'done' ? 100 : 0}
            color={t.status === 'failed' ? 'red' : t.status === 'done' ? 'teal' : 'blue'}
            aria-label={`Progresso de ${t.name}`}
          />
        </div>
      ))}
    </Stack>
  );
}

function errorText(error: unknown): string {
  if (error instanceof ApiError) return error.problem.detail ?? error.title;
  return 'Falha na operação.';
}

/** Navegador de arquivos da estacao: pastas, envio (botao ou arrastar e soltar), download, renomear e apagar. */
export function FilesPanel({ sessionId, transfers }: { sessionId: string; transfers: TransfersApi }) {
  const queryClient = useQueryClient();
  const home = useQuery({ queryKey: ['remote-files', sessionId, 'home'], queryFn: () => remoteFilesApi.home(sessionId), retry: 1 });
  const separator = home.data?.separator ?? '/';
  const [chosen, setChosen] = useState<string | null>(null);
  const path = chosen ?? home.data?.desktop ?? null;
  const [showHidden, setShowHidden] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [renaming, setRenaming] = useState<RemoteFileEntry | null>(null);
  const [deleting, setDeleting] = useState<RemoteFileEntry | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const list = useQuery({
    queryKey: ['remote-files', sessionId, 'list', path],
    queryFn: () => remoteFilesApi.list(sessionId, path ?? ''),
    enabled: path !== null,
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['remote-files', sessionId, 'list'] });

  const action = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: () => {
      setRenaming(null);
      setDeleting(null);
      setCreating(false);
      refresh();
    },
  });

  const send = async (files: File[]) => {
    if (!path || files.length === 0) return;
    await transfers.upload(files, path, separator);
    refresh();
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void send(Array.from(event.dataTransfer.files));
  };

  const submitName = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!path || !name.trim()) return;
    const target = joinPath(path, name.trim(), separator);
    if (creating) action.mutate(() => remoteFilesApi.mkdir(sessionId, target));
    else if (renaming) action.mutate(() => remoteFilesApi.rename(sessionId, renaming.path, target));
  };

  const rows = (list.data ?? []).filter((e) => showHidden || !e.hidden);
  const parent = path ? parentPath(path, separator) : null;
  const go = (p: string) => setChosen(p);

  if (home.isError) return <LoadError error={home.error} onRetry={() => void home.refetch()} />;

  return (
    <Stack gap="xs">
      <Group gap="xs" wrap="wrap">
        <Button size="xs" variant="default" leftSection={<IconHome size={14} />} onClick={() => home.data && go(home.data.desktop)}>
          Área de Trabalho
        </Button>
        <Button size="xs" variant="default" onClick={() => home.data && go(home.data.downloads)}>
          Downloads
        </Button>
        <Button size="xs" variant="default" onClick={() => home.data && go(home.data.home)}>
          Pasta pessoal
        </Button>
        <Tooltip label="Pasta de cima">
          <ActionIcon variant="default" aria-label="Pasta de cima" disabled={!parent} onClick={() => parent && go(parent)}>
            <IconArrowUp size={14} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Atualizar">
          <ActionIcon variant="default" aria-label="Atualizar" onClick={refresh}>
            <IconRefresh size={14} />
          </ActionIcon>
        </Tooltip>
        <Button size="xs" variant="default" leftSection={<IconFolderPlus size={14} />} onClick={() => { setName(''); setCreating(true); }}>
          Nova pasta
        </Button>
        <FileButton multiple onChange={(files) => void send(files)}>
          {(props) => (
            <Button size="xs" leftSection={<IconUpload size={14} />} {...props}>
              Enviar arquivos
            </Button>
          )}
        </FileButton>
        <Switch size="xs" label="Mostrar ocultos" checked={showHidden} onChange={(e) => setShowHidden(e.currentTarget.checked)} />
      </Group>
      {path && (
        <Breadcrumbs separator={separator === '\\' ? '\\' : '/'} separatorMargin={4}>
          {pathCrumbs(path, separator).map((c) => (
            <Anchor key={c.path} size="sm" onClick={() => go(c.path)} component="button" type="button">
              {c.label}
            </Anchor>
          ))}
        </Breadcrumbs>
      )}
      {list.isError && <LoadError error={list.error} onRetry={() => void list.refetch()} />}
      <Paper
        withBorder
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        style={dragging ? { outline: '2px dashed var(--mantine-color-blue-5)' } : undefined}
        aria-label="Arquivos da pasta (solte arquivos aqui para enviar)"
      >
        <Table.ScrollContainer minWidth={520}>
          <Table verticalSpacing={4} highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Nome</Table.Th>
                <Table.Th w={110}>Tamanho</Table.Th>
                <Table.Th w={150}>Modificado</Table.Th>
                <Table.Th w={40} aria-label="Ações" />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(list.isPending || home.isPending) && <LoadingRows columns={4} rows={4} />}
              {list.isSuccess && rows.length === 0 && <EmptyRow columns={4} message="Pasta vazia. Arraste arquivos para cá para enviar." />}
              {rows.map((entry) => (
                <Table.Tr key={entry.path}>
                  <Table.Td>
                    <Group gap={6} wrap="nowrap">
                      {entry.kind === 'dir' ? <IconFolder size={16} color="var(--mantine-color-yellow-6)" aria-hidden /> : <IconFile size={16} aria-hidden />}
                      {entry.kind === 'dir' ? (
                        <Anchor component="button" type="button" size="sm" onClick={() => go(entry.path)}>
                          {entry.name}
                        </Anchor>
                      ) : (
                        <Text size="sm">{entry.name}</Text>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{entry.kind === 'dir' ? '' : formatBytes(entry.size)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{formatDateTime(entry.modifiedAt, '')}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Menu position="bottom-end" withinPortal>
                      <Menu.Target>
                        <ActionIcon variant="subtle" color="gray" aria-label={`Ações de ${entry.name}`}>
                          <IconDots size={16} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item
                          leftSection={<IconDownload size={14} />}
                          component="a"
                          href={remoteFilesApi.downloadUrl(sessionId, [entry.path], entry.kind === 'dir')}
                          download
                        >
                          {entry.kind === 'dir' ? 'Baixar como zip' : 'Baixar'}
                        </Menu.Item>
                        <Menu.Item leftSection={<IconPencil size={14} />} onClick={() => { setName(entry.name); setRenaming(entry); }}>
                          Renomear
                        </Menu.Item>
                        <Menu.Item leftSection={<IconTrash size={14} />} color="red" onClick={() => setDeleting(entry)}>
                          Apagar
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
      <TransferList transfers={transfers.transfers} onClear={transfers.clear} />

      <Modal opened={creating || renaming !== null} onClose={() => { setCreating(false); setRenaming(null); }} title={creating ? 'Nova pasta' : 'Renomear'}>
        <form onSubmit={submitName}>
          <TextInput label="Nome" value={name} onChange={(e) => setName(e.currentTarget.value)} data-autofocus required />
          {action.isError && (
            <Text c="red" size="sm" mt="xs" role="alert">
              {errorText(action.error)}
            </Text>
          )}
          <Group justify="flex-end" mt="md">
            <Button type="submit" loading={action.isPending}>
              {creating ? 'Criar' : 'Renomear'}
            </Button>
          </Group>
        </form>
      </Modal>
      <Modal opened={deleting !== null} onClose={() => setDeleting(null)} title="Apagar">
        <Text size="sm">
          Apagar <strong>{deleting?.name}</strong>
          {deleting?.kind === 'dir' ? ' e tudo o que está dentro' : ''} na máquina remota? Não há lixeira.
        </Text>
        {action.isError && (
          <Text c="red" size="sm" mt="xs" role="alert">
            {errorText(action.error)}
          </Text>
        )}
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={() => setDeleting(null)}>
            Cancelar
          </Button>
          <Button color="red" loading={action.isPending} onClick={() => deleting && action.mutate(() => remoteFilesApi.remove(sessionId, deleting.path, deleting.kind === 'dir'))}>
            Apagar
          </Button>
        </Group>
      </Modal>
    </Stack>
  );
}
