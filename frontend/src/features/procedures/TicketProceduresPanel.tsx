import { ActionIcon, Button, Group, Paper, Stack, Text, Title, Tooltip } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { proceduresApi } from '../../api/procedures';
import { queryKeys } from '../../api/queryKeys';
import type { ProcedureDto, TicketDetail } from '../../api/types';
import { LoadError } from '../../components/TableStates';
import { confirmAction, notifySuccess } from '../../lib/feedback';
import { formatDateTime } from '../../lib/format';
import { formatMinutes } from '../tickets/ticketFormat';
import { PROCEDURE_KIND_INFO, procedureDuration } from './procedureFormat';
import { ProcedureKindBadge } from './ProceduresTable';
import { PickProceduresModal } from './ProcedureTicketModals';

interface TicketProceduresPanelProps {
  ticket: TicketDetail;
  /** Pode incluir e remover (tickets.manage); incluir tambem pede agents.view para listar os procedimentos. */
  canManage: boolean;
  canPick: boolean;
}

/** Procedimentos feitos nos agentes que entraram neste chamado, com o tempo de servico de cada um. */
export function TicketProceduresPanel({ ticket, canManage, canPick }: TicketProceduresPanelProps) {
  const queryClient = useQueryClient();
  const [pickerOpened, picker] = useDisclosure(false);
  const procedures = useQuery({ queryKey: queryKeys.ticketProcedures(ticket.id), queryFn: () => proceduresApi.forTicket(ticket.id) });
  const items = procedures.data ?? [];
  const service = items.reduce((sum, p) => sum + (p.serviceMinutes ?? 0), 0);
  const remove = useMutation({
    mutationFn: (p: ProcedureDto) => proceduresApi.remove(ticket.id, p.id),
    onSuccess: () => {
      notifySuccess('Procedimento removido do chamado.');
      void queryClient.invalidateQueries({ queryKey: queryKeys.ticketDetail(ticket.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.procedures });
    },
  });

  return (
    <Paper withBorder p="md" component="section" aria-labelledby="procedimentos-title">
      <Group justify="space-between" mb="xs">
        <Title order={5} id="procedimentos-title">
          Procedimentos
        </Title>
        {items.length > 0 && (
          <Text size="sm" fw={600}>
            {formatMinutes(service)}
          </Text>
        )}
      </Group>
      {procedures.isError && <LoadError error={procedures.error} onRetry={() => void procedures.refetch()} />}
      {procedures.isSuccess && items.length === 0 && (
        <Text size="sm" c="dimmed">
          Nenhum procedimento incluído. Acessos remotos abertos por este chamado entram sozinhos ao terminar.
        </Text>
      )}
      <Stack gap="xs">
        {items.map((p) => (
          <Group key={p.id} gap="xs" wrap="nowrap" align="flex-start">
            <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
              <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                <ProcedureKindBadge procedure={p} />
                {p.title && (
                  <Text size="sm" truncate title={p.title}>
                    {p.title}
                  </Text>
                )}
              </Group>
              <Text size="xs" c="dimmed">
                {p.hostname} · {formatDateTime(p.startedAt, '')} · {p.userName} · durou {procedureDuration(p)}
              </Text>
            </Stack>
            <Text size="sm" style={{ whiteSpace: 'nowrap' }}>
              {p.serviceMinutes !== null ? formatMinutes(p.serviceMinutes) : ''}
            </Text>
            {canManage && (
              <Tooltip label="Remover do chamado">
                <ActionIcon
                  variant="subtle"
                  color="red"
                  size="sm"
                  aria-label={`Remover ${PROCEDURE_KIND_INFO[p.kind].label.toLowerCase()} do chamado`}
                  onClick={() =>
                    confirmAction({
                      title: 'Remover procedimento do chamado',
                      message: `O procedimento continua registrado no agente, mas sai do chamado e o apontamento de ${formatMinutes(p.serviceMinutes ?? 0)} é excluído.`,
                      confirmLabel: 'Remover',
                      danger: true,
                      onConfirm: () => remove.mutate(p),
                    })
                  }
                >
                  <IconTrash size={14} />
                </ActionIcon>
              </Tooltip>
            )}
          </Group>
        ))}
      </Stack>
      {canManage && canPick && (
        <Button variant="light" fullWidth mt="sm" leftSection={<IconPlus size={16} />} onClick={picker.open}>
          Incluir procedimentos
        </Button>
      )}
      {canManage && canPick && <PickProceduresModal ticket={ticket} opened={pickerOpened} onClose={picker.close} />}
    </Paper>
  );
}
