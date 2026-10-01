import { useState } from 'react';
import { Alert, Anchor, Button, Group, Select, Stack, Text, Textarea } from '@mantine/core';
import { IconSparkles, IconUserCircle, IconUserMinus, IconUserPlus, IconArrowsExchange } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { assetsApi, peopleApi } from '../../api/inventory';
import { queryKeys } from '../../api/queryKeys';
import type { AssetSheet, SetResponsibleRequest } from '../../api/types';
import { personPath } from '../../app/paths';
import { formatDateTime } from '../../lib/format';
import { confirmAction, notifySuccess } from '../../lib/feedback';
import { Field, SheetCard } from './sheetDisplay';

const PEOPLE_PAGE_SIZE = 100;

export function ResponsibleCard({ sheet, canManage }: { sheet: AssetSheet; canManage: boolean }) {
  const queryClient = useQueryClient();
  const { asset, responsible, suggestedPerson } = sheet;
  const [changing, setChanging] = useState(false);
  const [personId, setPersonId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');

  const peopleParams = { clientId: asset.clientId, active: true, page: 1, pageSize: PEOPLE_PAGE_SIZE };
  const people = useQuery({
    queryKey: queryKeys.peopleList(peopleParams),
    queryFn: () => peopleApi.list(peopleParams),
    enabled: canManage && changing,
  });

  const assign = useMutation({
    mutationFn: (body: SetResponsibleRequest) => assetsApi.setResponsible(asset.id, body),
    onSuccess: (updated) => {
      notifySuccess(updated.responsible ? `Responsável: ${updated.responsible.name}.` : 'Responsável removido.');
      queryClient.setQueryData(queryKeys.assetSheet(asset.id), updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.assetLists });
      void queryClient.invalidateQueries({ queryKey: queryKeys.people });
      setChanging(false);
      setPersonId(null);
      setNotes('');
    },
  });

  const submit = () => {
    if (!personId) return;
    const trimmed = notes.trim();
    assign.mutate(trimmed ? { personId: Number(personId), notes: trimmed } : { personId: Number(personId) });
  };

  const options = (people.data?.items ?? [])
    .filter((p) => p.id !== responsible?.personId)
    .map((p) => ({ value: String(p.id), label: p.department ? `${p.name} (${p.department})` : p.name }));

  return (
    <SheetCard
      id="responsavel-title"
      title="Responsável"
      icon={IconUserCircle}
      actions={
        canManage &&
        !changing && (
          <>
            <Button
              size="compact-sm"
              variant="light"
              leftSection={responsible ? <IconArrowsExchange size={14} /> : <IconUserPlus size={14} />}
              onClick={() => setChanging(true)}
            >
              {responsible ? 'Trocar' : 'Atribuir'}
            </Button>
            {responsible && (
              <Button
                size="compact-sm"
                variant="subtle"
                color="red"
                leftSection={<IconUserMinus size={14} />}
                loading={assign.isPending && !personId}
                onClick={() =>
                  confirmAction({
                    title: 'Remover responsável',
                    message: `${responsible.name} deixa de ser responsável por ${asset.name}. O histórico é mantido.`,
                    confirmLabel: 'Remover',
                    danger: true,
                    onConfirm: () => assign.mutate({ personId: null }),
                  })
                }
              >
                Remover
              </Button>
            )}
          </>
        )
      }
    >
      <Stack gap="sm">
        {!responsible && suggestedPerson && (
          <Alert color="violet" variant="light" icon={<IconSparkles size={18} />} title={`Sugestão: ${suggestedPerson.name}`}>
            <Text size="sm">
              O último usuário logado{sheet.hardware?.lastLoggedInUser ? ` (${sheet.hardware.lastLoggedInUser})` : ''} corresponde ao login desta pessoa.
            </Text>
            {canManage && (
              <Button
                className="no-print"
                mt="xs"
                size="xs"
                color="violet"
                leftSection={<IconUserPlus size={14} />}
                loading={assign.isPending}
                onClick={() => assign.mutate({ personId: suggestedPerson.id })}
              >
                Atribuir sugestão
              </Button>
            )}
          </Alert>
        )}

        {responsible ? (
          <Stack gap="xs">
            <Anchor component={Link} to={personPath(responsible.personId)} fw={600} size="lg">
              {responsible.name}
            </Anchor>
            {responsible.department && <Field label="Departamento">{responsible.department}</Field>}
            {responsible.email && (
              <Field label="E-mail">
                <Anchor href={`mailto:${responsible.email}`} size="sm">
                  {responsible.email}
                </Anchor>
              </Field>
            )}
            {responsible.phone && <Field label="Telefone">{responsible.phone}</Field>}
            <Text size="xs" c="dimmed">
              Desde {formatDateTime(responsible.assignedAt)} · por {responsible.assignedBy}
            </Text>
          </Stack>
        ) : (
          <Text size="sm" c="dimmed">
            Sem responsável.
          </Text>
        )}

        {changing && (
          <form
            className="no-print"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <Stack gap="xs" pt="sm" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
              <Select
                label="Nova pessoa responsável"
                description={`Pessoas ativas de ${asset.clientName}`}
                placeholder="Escolha a pessoa"
                searchable
                data={options}
                value={personId}
                onChange={setPersonId}
                nothingFoundMessage={people.isFetching ? 'Carregando...' : 'Nenhuma pessoa encontrada'}
                data-autofocus
              />
              <Textarea
                label="Observação"
                placeholder="Opcional. Ex.: entrega do equipamento na troca de setor."
                autosize
                minRows={2}
                maxRows={5}
                value={notes}
                onChange={(e) => setNotes(e.currentTarget.value)}
              />
              <Group justify="flex-end" gap="xs">
                <Button
                  variant="default"
                  size="xs"
                  onClick={() => {
                    setChanging(false);
                    setPersonId(null);
                    setNotes('');
                  }}
                >
                  Cancelar
                </Button>
                <Button type="submit" size="xs" disabled={!personId} loading={assign.isPending}>
                  Salvar responsável
                </Button>
              </Group>
            </Stack>
          </form>
        )}
      </Stack>
    </SheetCard>
  );
}
