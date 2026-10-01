import { Button } from '@mantine/core';
import { IconId } from '@tabler/icons-react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { assetsApi } from '../../api/inventory';
import { assetPath } from '../../app/paths';

/** Abre a ficha do ativo do agente; o servidor cria o ativo se ainda nao existir. */
export function AgentAssetButton({ agentId }: { agentId: number }) {
  const navigate = useNavigate();
  const open = useMutation({
    mutationFn: () => assetsApi.forAgent(agentId),
    onSuccess: async ({ assetId }) => {
      await navigate(assetPath(assetId));
    },
  });
  return (
    <Button variant="light" leftSection={<IconId size={16} />} loading={open.isPending} onClick={() => open.mutate()}>
      Ficha do ativo
    </Button>
  );
}
