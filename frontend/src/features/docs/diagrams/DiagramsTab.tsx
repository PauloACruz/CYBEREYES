import { useState } from 'react';
import { ActionIcon, Anchor, Button, Group, Modal, Paper, Select, Stack, Table, Text, TextInput, Tooltip } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { diagramsApi } from '../../../api/docs';
import { queryKeys } from '../../../api/queryKeys';
import type { SaveDiagramRequest } from '../../../api/types';
import { diagramPath } from '../../../app/paths';
import { EmptyRow, LoadError, LoadingRows } from '../../../components/TableStates';
import { confirmAction, notifySuccess } from '../../../lib/feedback';
import { applyServerErrors } from '../../../lib/forms';
import { RelativeTime } from '../../agents/agentDisplay';
import { useClients } from '../../clients/useClients';
import { EMPTY_DIAGRAM } from './diagramModel';

const COLUMNS = 4;

export function DiagramsTab({ clientId, canManage }: { clientId: number | undefined; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const diagrams = useQuery({ queryKey: queryKeys.diagramList(clientId), queryFn: () => diagramsApi.list(clientId) });

  const remove = useMutation({
    mutationFn: (id: number) => diagramsApi.remove(id),
    onSuccess: () => {
      notifySuccess('Diagrama excluído.');
      void queryClient.invalidateQueries({ queryKey: queryKeys.diagrams });
    },
  });

  return (
    <>
      {canManage && (
        <Group justify="flex-end" mb="sm">
          <Button leftSection={<IconPlus size={16} />} onClick={() => setCreating(true)}>
            Novo diagrama
          </Button>
        </Group>
      )}
      {diagrams.isError && <LoadError error={diagrams.error} onRetry={() => void diagrams.refetch()} />}
      <Paper withBorder>
        <Table.ScrollContainer minWidth={640}>
          <Table verticalSpacing="xs" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Nome</Table.Th>
                <Table.Th w={200}>Cliente</Table.Th>
                <Table.Th w={200}>Atualizado</Table.Th>
                <Table.Th w={60} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {diagrams.isPending && <LoadingRows columns={COLUMNS} />}
              {diagrams.data && diagrams.data.length === 0 && <EmptyRow columns={COLUMNS} message="Nenhum diagrama de rede." />}
              {diagrams.data?.map((diagram) => (
                <Table.Tr key={diagram.id}>
                  <Table.Td>
                    <Anchor component={Link} to={diagramPath(diagram.id)} size="sm" fw={600}>
                      {diagram.name}
                    </Anchor>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{diagram.clientName}</Text>
                  </Table.Td>
                  <Table.Td>
                    <RelativeTime value={diagram.updatedAt} />
                    <Text size="xs" c="dimmed">
                      por {diagram.updatedBy}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    {canManage && (
                      <Tooltip label="Excluir">
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          aria-label={`Excluir ${diagram.name}`}
                          onClick={() =>
                            confirmAction({
                              title: 'Excluir diagrama',
                              message: `Excluir o diagrama ${diagram.name}?`,
                              confirmLabel: 'Excluir',
                              danger: true,
                              onConfirm: () => remove.mutate(diagram.id),
                            })
                          }
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Tooltip>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
      <Modal opened={creating} onClose={() => setCreating(false)} title="Novo diagrama" centered>
        {creating && <NewDiagramForm defaultClientId={clientId} onClose={() => setCreating(false)} />}
      </Modal>
    </>
  );
}

interface FormValues {
  clientId: string | null;
  siteId: string | null;
  name: string;
}

function NewDiagramForm({ defaultClientId, onClose }: { defaultClientId: number | undefined; onClose: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const clients = useClients();
  const form = useForm<FormValues>({
    initialValues: { clientId: defaultClientId ? String(defaultClientId) : null, siteId: null, name: '' },
    validate: {
      clientId: (v) => (v ? null : 'Escolha o cliente'),
      name: (v) => {
        const len = v.trim().length;
        if (len < 1) return 'Informe o nome';
        return len > 200 ? 'Use no máximo 200 caracteres' : null;
      },
    },
  });

  const create = useMutation({
    mutationFn: (body: SaveDiagramRequest) => diagramsApi.create(body),
    onSuccess: async (diagram) => {
      notifySuccess('Diagrama criado.');
      queryClient.setQueryData(queryKeys.diagram(diagram.id), diagram);
      void queryClient.invalidateQueries({ queryKey: queryKeys.diagrams });
      onClose();
      await navigate(diagramPath(diagram.id));
    },
    onError: (error) => applyServerErrors(form, error),
  });

  const selectedClient = clients.data?.find((c) => String(c.id) === form.values.clientId);

  return (
    <form
      onSubmit={form.onSubmit((v) =>
        create.mutate({ clientId: Number(v.clientId), siteId: v.siteId ? Number(v.siteId) : undefined, name: v.name.trim(), data: EMPTY_DIAGRAM }),
      )}
      noValidate
    >
      <Stack>
        <TextInput label="Nome" required data-autofocus maxLength={200} placeholder="Rede da matriz" {...form.getInputProps('name')} />
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
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={create.isPending}>
            Criar e abrir
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
