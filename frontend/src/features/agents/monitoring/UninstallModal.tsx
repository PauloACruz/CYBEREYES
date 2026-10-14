import { useState } from 'react';
import { Alert, Button, Checkbox, Code, Group, Modal, Radio, Stack, Text } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { softwareApi } from '../../../api/monitoring';
import { queryKeys } from '../../../api/queryKeys';
import type { AgentDetail, SoftwareItem, UninstallScanMode } from '../../../api/types';
import { ApiErrorAlert } from '../../../components/ApiErrorAlert';
import { notifySuccess } from '../../../lib/feedback';
import { SCAN_MODES } from './softwareActions';

interface UninstallModalProps {
  agent: AgentDetail;
  item: SoftwareItem | null;
  onClose: () => void;
}

type Method = 'uninstaller' | 'forced';

/** Desinstalacao avancada: desinstalador do programa sem janela, varredura de sobras e revisao no console. */
export function UninstallModal({ agent, item, onClose }: UninstallModalProps) {
  const queryClient = useQueryClient();
  const [method, setMethod] = useState<Method>('uninstaller');
  const [mode, setMode] = useState<UninstallScanMode>('moderate');
  const [restorePoint, setRestorePoint] = useState(false);
  const uninstall = useMutation({
    mutationFn: (target: SoftwareItem) =>
      softwareApi.uninstall(agent.id, {
        name: target.name,
        version: target.version,
        publisher: target.publisher,
        location: target.location,
        key: target.key ?? '',
        mode,
        runUninstaller: method === 'uninstaller',
        restorePoint,
      }),
    onSuccess: (_, target) => {
      notifySuccess(`A desinstalação de ${target.name} foi enviada ao agente. As sobras aparecem em "Ações pendentes e recentes".`, 'Desinstalação solicitada');
      void queryClient.invalidateQueries({ queryKey: queryKeys.agentPendingActions(agent.id) });
      close();
    },
  });
  const close = () => {
    uninstall.reset();
    setMethod('uninstaller');
    setMode('moderate');
    setRestorePoint(false);
    onClose();
  };

  return (
    <Modal opened={item !== null} onClose={close} title="Desinstalação avançada" size="lg" centered>
      {item && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            uninstall.mutate(item);
          }}
        >
          <Stack>
            <div>
              <Text fw={600}>{item.name}</Text>
              <Text size="sm" c="dimmed">
                {[item.version && `Versão ${item.version}`, item.publisher, agent.hostname].filter(Boolean).join(' · ')}
              </Text>
              {item.uninstall && (
                <Code block mt="xs" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {item.uninstall}
                </Code>
              )}
            </div>
            <Radio.Group label="Como remover" value={method} onChange={setMethod}>
              <Stack gap="xs" mt="xs">
                <Radio
                  value="uninstaller"
                  label="Executar o desinstalador do programa"
                  description="Roda o desinstalador registrado, sem janela, e depois procura as sobras."
                />
                <Radio
                  value="forced"
                  label="Remoção forçada"
                  description="Não executa o desinstalador: só procura os arquivos, chaves e serviços do programa para você apagar. Use quando o desinstalador estiver quebrado ou não tiver modo silencioso."
                />
              </Stack>
            </Radio.Group>
            <Radio.Group label="Varredura de sobras" value={mode} onChange={setMode}>
              <Stack gap="xs" mt="xs">
                {SCAN_MODES.map((m) => (
                  <Radio key={m.value} value={m.value} label={m.label} description={m.description} />
                ))}
              </Stack>
            </Radio.Group>
            <Checkbox
              label="Criar ponto de restauração antes"
              description="Só em estações com a Restauração do Sistema ligada; o Windows cria no máximo um a cada 24 horas."
              checked={restorePoint}
              onChange={(e) => setRestorePoint(e.currentTarget.checked)}
            />
            <Alert color="blue" variant="light" icon={<IconInfoCircle size={18} />}>
              Nada além do desinstalador é apagado agora. Quando o agente terminar, revise as sobras encontradas e escolha o que remover.
            </Alert>
            {uninstall.isError && <ApiErrorAlert error={uninstall.error} />}
            <Group justify="flex-end">
              <Button variant="default" onClick={close}>
                Cancelar
              </Button>
              <Button type="submit" color="red" loading={uninstall.isPending}>
                {method === 'forced' ? 'Procurar sobras' : 'Desinstalar'}
              </Button>
            </Group>
          </Stack>
        </form>
      )}
    </Modal>
  );
}
