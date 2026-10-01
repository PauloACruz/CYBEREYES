import { useState } from 'react';
import { Button, Group, Modal, Stack, Text, TextInput } from '@mantine/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { agentsApi } from '../../api/agents';
import { queryKeys } from '../../api/queryKeys';
import type { AgentDetail } from '../../api/types';
import { PATHS } from '../../app/paths';
import { notifySuccess } from '../../lib/feedback';

interface DeleteAgentModalProps {
  agent: AgentDetail;
  opened: boolean;
  onClose: () => void;
}

export function DeleteAgentModal({ agent, opened, onClose }: DeleteAgentModalProps) {
  const [typed, setTyped] = useState('');
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const close = () => {
    setTyped('');
    onClose();
  };
  const remove = useMutation({
    mutationFn: () => agentsApi.remove(agent.id),
    onSuccess: async () => {
      notifySuccess(`Agente ${agent.hostname} excluído.`);
      queryClient.removeQueries({ queryKey: queryKeys.agentDetail(agent.id) });
      await navigate(PATHS.agents, { replace: true });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.agents }),
        queryClient.invalidateQueries({ queryKey: queryKeys.clients }),
      ]);
    },
  });
  const matches = typed.trim() === agent.hostname;

  return (
    <Modal opened={opened} onClose={close} title="Excluir agente" centered>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (matches) remove.mutate();
        }}
      >
        <Stack>
          <Text size="sm">
            O agente <b>{agent.hostname}</b> será removido do console e deixará de ser monitorado. O programa instalado na máquina
            não é desinstalado. Esta ação não pode ser desfeita.
          </Text>
          <TextInput
            label={`Digite ${agent.hostname} para confirmar`}
            value={typed}
            onChange={(e) => setTyped(e.currentTarget.value)}
            autoComplete="off"
            data-autofocus
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={close}>
              Cancelar
            </Button>
            <Button type="submit" color="red" disabled={!matches} loading={remove.isPending}>
              Excluir agente
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
