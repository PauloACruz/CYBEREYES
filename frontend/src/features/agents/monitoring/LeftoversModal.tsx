import { useMemo, useState } from 'react';
import { Alert, Badge, Button, Checkbox, Group, Modal, ScrollArea, Stack, Table, Text } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { softwareApi } from '../../../api/monitoring';
import { queryKeys } from '../../../api/queryKeys';
import type { AgentDetail, SoftwareActionResult, SoftwareLeftover } from '../../../api/types';
import { ApiErrorAlert } from '../../../components/ApiErrorAlert';
import { confirmAction, notifySuccess } from '../../../lib/feedback';
import { KIND_LABELS, LEVEL_LABELS, defaultSelection, leftoverId } from './softwareActions';

export interface LeftoversTarget {
  actionId: number;
  name: string;
  result: SoftwareActionResult;
}

interface LeftoversModalProps {
  agent: AgentDetail;
  target: LeftoversTarget | null;
  onClose: () => void;
}

/** Revisao das sobras encontradas, nos moldes do Revo Uninstaller: o tecnico marca o que o agente deve apagar. */
export function LeftoversModal({ agent, target, onClose }: LeftoversModalProps) {
  return (
    <Modal opened={target !== null} onClose={onClose} title={target ? `Sobras de ${target.name}` : 'Sobras'} size="xl" centered>
      {target && <LeftoversForm key={target.actionId} agent={agent} target={target} onClose={onClose} />}
    </Modal>
  );
}

function LeftoversForm({ agent, target, onClose }: { agent: AgentDetail; target: LeftoversTarget; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { result } = target;
  const [selected, setSelected] = useState(() => defaultSelection(result));
  const items = result.leftovers;
  const chosen = useMemo(() => items.filter((l) => selected.has(leftoverId(l))), [items, selected]);
  const cleanup = useMutation({
    mutationFn: (list: SoftwareLeftover[]) =>
      softwareApi.cleanup(
        agent.id,
        target.actionId,
        list.map(({ kind, path, name }) => ({ kind, path, name })),
      ),
    onSuccess: (_, list) => {
      notifySuccess(`A remoção de ${list.length} sobra(s) foi enviada ao agente.`, 'Limpeza solicitada');
      void queryClient.invalidateQueries({ queryKey: queryKeys.agentPendingActions(agent.id) });
      onClose();
    },
  });
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const allOn = items.length > 0 && chosen.length === items.length;
  const submit = () =>
    confirmAction({
      title: 'Remover sobras',
      message: `Apagar ${chosen.length} item(ns) em ${agent.hostname}? Chaves do registro, valores, serviços e tarefas são copiados antes para a pasta de dados do EYES; pastas e atalhos são apagados definitivamente. O que estiver em uso fica para o próximo reinício.`,
      confirmLabel: 'Remover',
      danger: true,
      onConfirm: () => cleanup.mutate(chosen),
    });

  return (
    <Stack>
      {result.ranUninstaller && result.stillInstalled && (
        <Alert color="orange" variant="light" icon={<IconAlertTriangle size={18} />} title="O programa continua registrado no Windows">
          O desinstalador terminou, mas a entrada do programa não sumiu. Os itens abaixo podem ser do programa ainda instalado; nada
          vem marcado.
        </Alert>
      )}
      {!result.ranUninstaller && result.stillInstalled && (
        <Alert color="orange" variant="light" icon={<IconAlertTriangle size={18} />} title="Remoção forçada">
          O desinstalador não foi executado: os itens marcados serão apagados com o programa ainda instalado.
        </Alert>
      )}
      <Group justify="space-between">
        <Checkbox
          label="Marcar todos"
          checked={allOn}
          indeterminate={chosen.length > 0 && !allOn}
          onChange={(e) => setSelected(e.currentTarget.checked ? new Set(items.map(leftoverId)) : new Set())}
        />
        <Button variant="subtle" size="xs" onClick={() => setSelected(defaultSelection({ ...result, ranUninstaller: false, stillInstalled: false }))}>
          Marcar os de alta confiança
        </Button>
      </Group>
      <ScrollArea.Autosize mah={420} type="auto">
        <Table verticalSpacing="xs" striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={40} aria-label="Selecionar" />
              <Table.Th>Item</Table.Th>
              <Table.Th w={170}>Tipo</Table.Th>
              <Table.Th w={110}>Confiança</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.map((item) => {
              const id = leftoverId(item);
              const label = item.kind === 'value' ? `${item.name ?? ''} em ${item.path}` : item.path;
              return (
                <Table.Tr key={id}>
                  <Table.Td>
                    <Checkbox aria-label={`Remover ${label}`} checked={selected.has(id)} onChange={(e) => toggle(id, e.currentTarget.checked)} />
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" style={{ wordBreak: 'break-all' }}>
                      {label}
                    </Text>
                    {item.detail && (
                      <Text size="xs" c="dimmed" style={{ wordBreak: 'break-all' }}>
                        {item.detail}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Stack gap={4} align="flex-start">
                      <Text size="sm">{KIND_LABELS[item.kind]}</Text>
                      {item.user && (
                        <Badge size="xs" variant="outline" color="grape">
                          Dados do usuário
                        </Badge>
                      )}
                    </Stack>
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="light" color={LEVEL_LABELS[item.level].color}>
                      {LEVEL_LABELS[item.level].label}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </ScrollArea.Autosize>
      {cleanup.isError && <ApiErrorAlert error={cleanup.error} />}
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          {chosen.length} de {items.length} selecionado(s)
        </Text>
        <Group>
          <Button variant="default" onClick={onClose}>
            Fechar
          </Button>
          <Button color="red" disabled={chosen.length === 0} loading={cleanup.isPending} onClick={submit}>
            Remover selecionados
          </Button>
        </Group>
      </Group>
    </Stack>
  );
}
