import { useState } from 'react';
import { Anchor, Breadcrumbs, Button, Center, Group, Loader, Paper, Select, SimpleGrid, Stack, Text, Textarea, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconDeviceFloppy, IconMarkdown, IconPencil, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ApiError } from '../../../api/client';
import { docPagesApi } from '../../../api/docs';
import { queryKeys } from '../../../api/queryKeys';
import { PERMISSIONS, type DocPageDetail, type SaveDocPageRequest } from '../../../api/types';
import { docPagePath, docsTabPath } from '../../../app/paths';
import { hasPermission } from '../../../auth/permissions';
import { useMe } from '../../../auth/useMe';
import { AccessDenied } from '../../../components/AccessDenied';
import { NotFound } from '../../../components/NotFound';
import { LoadError } from '../../../components/TableStates';
import { confirmAction, notifySuccess } from '../../../lib/feedback';
import { formatDateTime } from '../../../lib/format';
import { applyServerErrors } from '../../../lib/forms';
import { useClients } from '../../clients/useClients';
import { toId } from '../../inventory/inventoryFormat';
import { MarkdownView } from './MarkdownView';
import { PageTitle } from '../../../components/PageTitle';

const MAX_BODY = 200_000;

function PageBreadcrumbs({ title }: { title: string }) {
  return (
    <Breadcrumbs mb="xs">
      <Anchor component={Link} to={docsTabPath('redes')} size="sm">
        Documentação
      </Anchor>
      <Anchor component={Link} to={docsTabPath('paginas')} size="sm">
        Páginas
      </Anchor>
      <Text size="sm">{title}</Text>
    </Breadcrumbs>
  );
}

/** Nova pagina (/documentacao/paginas/nova). */
export function NewDocPagePage() {
  const { data: me } = useMe();
  const [searchParams] = useSearchParams();
  if (!hasPermission(me, PERMISSIONS.docsManage)) return <AccessDenied />;
  return (
    <>
      <PageBreadcrumbs title="Nova página" />
      <DocPageForm defaultClientId={toId(searchParams.get('cliente'))} />
    </>
  );
}

export function DocPageEditorPage() {
  const { id: rawId } = useParams();
  const id = Number(rawId);
  const valid = Number.isInteger(id) && id > 0;
  const page = useQuery({ queryKey: queryKeys.docPage(id), queryFn: () => docPagesApi.get(id), enabled: valid });

  if (!valid || (page.error instanceof ApiError && page.error.status === 404)) return <NotFound />;
  if (page.isError) return <LoadError error={page.error} onRetry={() => void page.refetch()} />;
  if (!page.data) {
    return (
      <Center py="xl">
        <Loader aria-label="Carregando página" />
      </Center>
    );
  }
  return <DocPageView page={page.data} />;
}

function DocPageView({ page }: { page: DocPageDetail }) {
  const { data: me } = useMe();
  const canManage = hasPermission(me, PERMISSIONS.docsManage);
  const [editing, setEditing] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const remove = useMutation({
    mutationFn: () => docPagesApi.remove(page.id),
    onSuccess: async () => {
      notifySuccess('Página excluída.');
      queryClient.removeQueries({ queryKey: queryKeys.docPage(page.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.docPages });
      await navigate(docsTabPath('paginas'));
    },
  });

  if (editing) {
    return (
      <>
        <PageBreadcrumbs title={page.title} />
        <DocPageForm page={page} onDone={() => setEditing(false)} />
      </>
    );
  }

  return (
    <>
      <PageBreadcrumbs title={page.title} />
      <Group justify="space-between" align="flex-start" mb="lg" wrap="wrap" gap="sm">
        <PageTitle
          title={page.title}
          description={
            <>
              {page.clientName ? `${page.clientName} · ` : ''}Atualizada em {formatDateTime(page.updatedAt)} por {page.updatedBy}
            </>
          }
        />
        {canManage && (
          <Group gap="sm">
            <Button leftSection={<IconPencil size={16} />} onClick={() => setEditing(true)}>
              Editar
            </Button>
            <Button
              color="red"
              variant="light"
              leftSection={<IconTrash size={16} />}
              loading={remove.isPending}
              onClick={() =>
                confirmAction({
                  title: 'Excluir página',
                  message: `Excluir a página ${page.title}?`,
                  confirmLabel: 'Excluir',
                  danger: true,
                  onConfirm: () => remove.mutate(),
                })
              }
            >
              Excluir
            </Button>
          </Group>
        )}
      </Group>
      <Paper withBorder p="lg">
        <MarkdownView body={page.body} />
      </Paper>
    </>
  );
}

interface FormValues {
  clientId: string | null;
  siteId: string | null;
  title: string;
  body: string;
}

function DocPageForm({ page, defaultClientId, onDone }: { page?: DocPageDetail; defaultClientId?: number; onDone?: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const clients = useClients();
  const form = useForm<FormValues>({
    initialValues: {
      clientId: page ? String(page.clientId) : defaultClientId ? String(defaultClientId) : null,
      siteId: page?.siteId ? String(page.siteId) : null,
      title: page?.title ?? '',
      body: page?.body ?? '',
    },
    validate: {
      clientId: (v) => (v ? null : 'Escolha o cliente'),
      title: (v) => {
        const len = v.trim().length;
        if (len < 2) return 'Use pelo menos 2 caracteres';
        return len > 200 ? 'Use no máximo 200 caracteres' : null;
      },
      body: (v) => (v.length > MAX_BODY ? 'O texto passou do limite de 200 000 caracteres' : null),
    },
  });

  const save = useMutation({
    mutationFn: (body: SaveDocPageRequest) => (page ? docPagesApi.update(page.id, body) : docPagesApi.create(body)),
    onSuccess: async (saved) => {
      notifySuccess(page ? 'Página salva.' : 'Página criada.');
      queryClient.setQueryData(queryKeys.docPage(saved.id), saved);
      void queryClient.invalidateQueries({ queryKey: queryKeys.docPages });
      if (page) onDone?.();
      else await navigate(docPagePath(saved.id), { replace: true });
    },
    onError: (error) => applyServerErrors(form, error),
  });

  const selectedClient = clients.data?.find((c) => String(c.id) === form.values.clientId);

  return (
    <form
      onSubmit={form.onSubmit((v) =>
        save.mutate({ clientId: Number(v.clientId), siteId: v.siteId ? Number(v.siteId) : undefined, title: v.title.trim(), body: v.body }),
      )}
      noValidate
    >
      <Stack>
        <Group justify="space-between" wrap="wrap">
          <Title order={2}>{page ? 'Editar página' : 'Nova página'}</Title>
          <Group gap="sm">
            {page ? (
              <Button variant="default" onClick={onDone}>
                Cancelar
              </Button>
            ) : (
              <Button variant="default" component={Link} to={docsTabPath('paginas')}>
                Cancelar
              </Button>
            )}
            <Button type="submit" leftSection={<IconDeviceFloppy size={16} />} loading={save.isPending}>
              Salvar
            </Button>
          </Group>
        </Group>
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <TextInput label="Título" required maxLength={200} data-autofocus {...form.getInputProps('title')} />
          <Select
            label="Cliente"
            required
            searchable
            data={(clients.data ?? []).map((c) => ({ value: String(c.id), label: c.name }))}
            value={form.values.clientId}
            error={form.errors.clientId}
            onChange={(v) => {
              form.setFieldValue('clientId', v);
              form.setFieldValue('siteId', null);
            }}
          />
          <Select
            label="Site"
            placeholder={selectedClient ? 'Sem site' : 'Escolha o cliente primeiro'}
            clearable
            disabled={!selectedClient}
            data={(selectedClient?.sites ?? []).map((s) => ({ value: String(s.id), label: s.name }))}
            {...form.getInputProps('siteId')}
          />
        </SimpleGrid>
        <SimpleGrid cols={{ base: 1, md: 2 }}>
          <Textarea
            label="Conteúdo (Markdown)"
            description={
              <Group gap={4} component="span">
                <IconMarkdown size={14} aria-hidden />
                <span>Títulos com #, listas com -, **negrito** e `código`. HTML não é interpretado.</span>
              </Group>
            }
            autosize
            minRows={18}
            maxRows={40}
            styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
            {...form.getInputProps('body')}
          />
          <Stack gap={4}>
            <Text size="sm" fw={500}>
              Pré-visualização
            </Text>
            <Paper withBorder p="md" mih={300} aria-label="Pré-visualização" component="section">
              <MarkdownView body={form.values.body} />
            </Paper>
          </Stack>
        </SimpleGrid>
      </Stack>
    </form>
  );
}
