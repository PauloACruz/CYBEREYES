import { useState } from 'react';
import { Alert, Button, Group, Modal, Select, Stack, Text } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { agentsApi } from '../../../api/agents';
import { queryKeys } from '../../../api/queryKeys';
import { notifySuccess } from '../../../lib/feedback';
import { siteSelectGroups, useClients } from '../../clients/useClients';

export interface MoveAgentTarget {
  id: number;
  hostname: string;
  clientId: number;
  clientName: string;
  siteId: number;
  siteName: string;
}

interface MoveAgentModalProps {
  agent: MoveAgentTarget;
  opened: boolean;
  onClose: () => void;
}

/** Muda o agente de cliente ou site. O agente nao guarda o site: a mudanca vale no proximo check-in, com as politicas do novo lugar. */
export function MoveAgentModal({ agent, opened, onClose }: MoveAgentModalProps) {
  const queryClient = useQueryClient();
  const clients = useClients(opened);
  const [siteId, setSiteId] = useState<string | null>(String(agent.siteId));
  const target = clients.data?.flatMap((c) => c.sites.map((s) => ({ ...s, clientId: c.id }))).find((s) => String(s.id) === siteId);
  const clientChanges = target !== undefined && target.clientId !== agent.clientId;

  const move = useMutation({
    mutationFn: () => agentsApi.move(agent.id, Number(siteId)),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.agents });
      await queryClient.invalidateQueries({ queryKey: queryKeys.clients });
      const tickets = result.movedTickets === 1 ? ' 1 chamado aberto foi junto.' : result.movedTickets > 1 ? ` ${result.movedTickets} chamados abertos foram junto.` : '';
      notifySuccess(`${agent.hostname} agora está em ${result.clientName} / ${result.siteName}.${tickets}`, 'Agente movido');
      onClose();
    },
  });

  return (
    <Modal opened={opened} onClose={onClose} title="Mudar cliente ou site" size="lg">
      <Stack gap="md">
        <Text size="sm">
          <Text span ff="monospace" fw={500}>
            {agent.hostname}
          </Text>{' '}
          está em {agent.clientName} / {agent.siteName}.
        </Text>
        <Select
          label="Novo cliente / site"
          placeholder={clients.isPending ? 'Carregando clientes…' : 'Escolha o site'}
          data={siteSelectGroups(clients.data)}
          value={siteId}
          onChange={setSiteId}
          searchable
          nothingFoundMessage="Nenhum site encontrado"
          disabled={clients.isPending}
          data-autofocus
          comboboxProps={{ withinPortal: true }}
        />
        <Alert variant="light" color="gray" icon={<IconInfoCircle size={18} />} p="sm">
          <Text size="sm">
            As políticas, os alertas e os relatórios passam a seguir o novo lugar. Os chamados abertos da máquina e o ativo do inventário vão junto; os
            chamados encerrados ficam com o cliente atual.
            {clientChanges && ' Como o cliente muda, o responsável pelo ativo (uma pessoa do cliente atual) é desvinculado.'}
          </Text>
        </Alert>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => move.mutate()} loading={move.isPending} disabled={!siteId || siteId === String(agent.siteId)}>
            Mover
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
