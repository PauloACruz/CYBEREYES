import { useState } from 'react';
import { ActionIcon, Badge, Button, Group, MultiSelect, Paper, Select, Stack, Switch, Table, Text, Tooltip } from '@mantine/core';
import { IconArrowDown, IconArrowUp, IconX } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ticketRotationApi } from '../../api/tickets';
import type { TicketRotationDto } from '../../api/types';
import { EmptyRow, LoadError, LoadingRows } from '../../components/TableStates';
import { notifySuccess } from '../../lib/feedback';
import { formatDateTime } from '../../lib/format';

const COLUMNS = 7;
const QUERY_KEY = ['ticket-rotation'];

interface DraftMember {
  userId: string;
  name: string;
  active: boolean;
  queueIds: string[];
}

/** Aba Fila em Usuários: quem recebe os chamados novos e em que ordem o agente reveza. */
export function TicketRotationTab({ canManage }: { canManage: boolean }) {
  const rotation = useQuery({ queryKey: QUERY_KEY, queryFn: ticketRotationApi.get });

  if (rotation.isError) return <LoadError error={rotation.error} onRetry={() => void rotation.refetch()} />;
  if (!rotation.data) {
    return (
      <Paper withBorder>
        <Table>
          <Table.Tbody>
            <LoadingRows columns={COLUMNS} rows={3} />
          </Table.Tbody>
        </Table>
      </Paper>
    );
  }
  // A edição recomeça do que o servidor devolveu a cada gravação.
  return <RotationEditor key={rotation.dataUpdatedAt} data={rotation.data} canManage={canManage} />;
}

function RotationEditor({ data, canManage }: { data: TicketRotationDto; canManage: boolean }) {
  const queryClient = useQueryClient();
  const queueIds = new Set(data.queues.map((q) => q.id));
  const initial = data.members.map((m) => ({
    userId: m.userId,
    name: m.name,
    active: m.active,
    // Fila excluída depois de escolhida some da lista.
    queueIds: m.queueIds.map(String).filter((id) => queueIds.has(id)),
  }));
  const [enabled, setEnabled] = useState(data.enabled);
  const [members, setMembers] = useState<DraftMember[]>(initial);
  const saved = new Map(data.members.map((m) => [m.userId, m]));
  const dirty = enabled !== data.enabled || JSON.stringify(members) !== JSON.stringify(initial);
  const pool = [...data.candidates, ...data.members.map((m) => ({ id: m.userId, name: m.name }))];
  const candidates = pool
    .filter((c) => !members.some((m) => m.userId === c.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    .map((c) => ({ value: c.id, label: c.name }));

  const save = useMutation({
    mutationFn: () =>
      ticketRotationApi.save({
        enabled,
        members: members.map((m) => ({ userId: m.userId, active: m.active, queueIds: m.queueIds.map(Number) })),
      }),
    onSuccess: (result) => {
      queryClient.setQueryData(QUERY_KEY, result);
      notifySuccess('Fila de atendimento salva.');
    },
  });

  const update = (userId: string, change: Partial<DraftMember>) =>
    setMembers((current) => current.map((m) => (m.userId === userId ? { ...m, ...change } : m)));
  const move = (index: number, offset: number) =>
    setMembers((current) => {
      const next = [...current];
      next.splice(index + offset, 0, ...next.splice(index, 1));
      return next;
    });
  const add = (userId: string | null) => {
    const option = pool.find((c) => c.id === userId);
    if (option) setMembers((current) => [...current, { userId: option.id, name: option.name, active: true, queueIds: [] }]);
  };

  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed" maw={900}>
        Cada chamado aberto sem técnico vai para quem está há mais tempo sem receber um, entre os técnicos ativos na fila que atendem a fila
        do chamado e veem o cliente dele; no empate, vale a ordem da lista. O agente registra a atribuição na conversa do chamado. Quem
        escolhe o técnico ao abrir o chamado não passa pelo rodízio.
      </Text>
      <Switch
        label="Distribuir os chamados novos por rodízio"
        checked={enabled}
        disabled={!canManage}
        onChange={(e) => setEnabled(e.currentTarget.checked)}
      />
      <Paper withBorder>
        <Table.ScrollContainer minWidth={860}>
          <Table verticalSpacing="sm" aria-label="Fila de atendimento">
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={90}>Ordem</Table.Th>
                <Table.Th>Técnico</Table.Th>
                <Table.Th>Filas de chamados</Table.Th>
                <Table.Th w={90}>Na fila</Table.Th>
                <Table.Th>Último chamado</Table.Th>
                <Table.Th w={80}>Abertos</Table.Th>
                <Table.Th w={50}>
                  <span className="mantine-visually-hidden">Ações</span>
                </Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {members.length === 0 && (
                <EmptyRow columns={COLUMNS} message="Ninguém na fila: os chamados novos ficam sem técnico até alguém assumir." />
              )}
              {members.map((m, index) => {
                const current = saved.get(m.userId);
                return (
                  <Table.Tr key={m.userId}>
                    <Table.Td>
                      <Group gap={2} wrap="nowrap">
                        <Text size="sm" w={20}>
                          {index + 1}
                        </Text>
                        {canManage && (
                          <>
                            <ActionIcon variant="subtle" color="gray" size="sm" aria-label={`Subir ${m.name}`} disabled={index === 0} onClick={() => move(index, -1)}>
                              <IconArrowUp size={14} />
                            </ActionIcon>
                            <ActionIcon
                              variant="subtle"
                              color="gray"
                              size="sm"
                              aria-label={`Descer ${m.name}`}
                              disabled={index === members.length - 1}
                              onClick={() => move(index, 1)}
                            >
                              <IconArrowDown size={14} />
                            </ActionIcon>
                          </>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Group gap="xs">
                        <Text size="sm" fw={500}>
                          {m.name}
                        </Text>
                        {data.enabled && data.nextUserId === m.userId && (
                          <Tooltip label="Recebe o próximo chamado, se atender a fila e o cliente dele" withArrow>
                            <Badge size="sm" variant="light" color="teal">
                              Próximo
                            </Badge>
                          </Tooltip>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <MultiSelect
                        aria-label={`Filas de ${m.name}`}
                        placeholder={m.queueIds.length === 0 ? 'Todas as filas' : undefined}
                        data={data.queues.map((q) => ({ value: q.id, label: q.name }))}
                        value={m.queueIds}
                        onChange={(value) => update(m.userId, { queueIds: value })}
                        disabled={!canManage}
                        clearable
                        size="xs"
                        maw={320}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Switch
                        aria-label={`${m.name} na fila`}
                        checked={m.active}
                        disabled={!canManage}
                        onChange={(e) => update(m.userId, { active: e.currentTarget.checked })}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c={current?.lastAssignedAt ? undefined : 'dimmed'}>
                        {current?.lastAssignedAt ? formatDateTime(current.lastAssignedAt) : 'Nunca'}
                      </Text>
                    </Table.Td>
                    <Table.Td>{current?.openTickets ?? 0}</Table.Td>
                    <Table.Td>
                      {canManage && (
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          aria-label={`Tirar ${m.name} da fila`}
                          onClick={() => setMembers((list) => list.filter((x) => x.userId !== m.userId))}
                        >
                          <IconX size={16} />
                        </ActionIcon>
                      )}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
      {canManage && (
        <Group justify="space-between">
          <Select
            aria-label="Adicionar técnico à fila"
            placeholder={candidates.length === 0 ? 'Todos os técnicos já estão na fila' : 'Adicionar técnico à fila'}
            data={candidates}
            value={null}
            onChange={add}
            disabled={candidates.length === 0}
            searchable
            w={320}
          />
          <Button onClick={() => save.mutate()} disabled={!dirty} loading={save.isPending}>
            Salvar fila
          </Button>
        </Group>
      )}
      {!canManage && (
        <Text size="sm" c="dimmed">
          Só quem pode gerenciar usuários altera a fila.
        </Text>
      )}
    </Stack>
  );
}
