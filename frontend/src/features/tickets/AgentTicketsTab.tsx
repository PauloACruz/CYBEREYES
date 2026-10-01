import { Button, Group, Paper, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconPlus } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import { ticketsApi } from '../../api/tickets';
import { PERMISSIONS, type AgentDetail } from '../../api/types';
import { hasPermission } from '../../auth/permissions';
import { useMe } from '../../auth/useMe';
import { LoadError } from '../../components/TableStates';
import { CreateTicketModal } from './CreateTicketModal';
import { TicketsTable } from './TicketsTable';

export function AgentTicketsTab({ agent }: { agent: AgentDetail }) {
  const { data: me } = useMe();
  const canManage = hasPermission(me, PERMISSIONS.ticketsManage);
  const [createOpened, createModal] = useDisclosure(false);
  const tickets = useQuery({ queryKey: queryKeys.agentTickets(agent.id), queryFn: () => ticketsApi.forAgent(agent.id) });

  return (
    <>
      <Group justify="space-between" mb="md">
        <Text size="sm" c="dimmed">
          Últimos 50 chamados desta máquina.
        </Text>
        {canManage && (
          <Button leftSection={<IconPlus size={16} />} onClick={createModal.open}>
            Abrir chamado
          </Button>
        )}
      </Group>
      {tickets.isError && <LoadError error={tickets.error} onRetry={() => void tickets.refetch()} />}
      <Paper withBorder>
        <TicketsTable tickets={tickets.data ?? []} loading={tickets.isPending} showMachine={false} emptyMessage="Nenhum chamado para esta máquina." />
      </Paper>
      {canManage && (
        <CreateTicketModal
          opened={createOpened}
          onClose={createModal.close}
          agent={{ id: agent.id, hostname: agent.hostname, loggedInUsername: agent.loggedInUsername ?? agent.lastLoggedInUser }}
        />
      )}
    </>
  );
}
