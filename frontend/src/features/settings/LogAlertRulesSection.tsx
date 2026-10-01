import { useState } from 'react';
import { ActionIcon, Badge, Button, Group, Modal, NumberInput, Paper, Select, SimpleGrid, Stack, Switch, Table, Text, TextInput, Title, Tooltip } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { logAlertRulesApi } from '../../api/logs';
import { queryKeys } from '../../api/queryKeys';
import type { LogAlertRuleDto, LogLevel, SaveLogAlertRuleRequest, Severity } from '../../api/types';
import { EmptyRow, LoadError, LoadingRows } from '../../components/TableStates';
import { confirmAction, notifySuccess } from '../../lib/feedback';
import { applyServerErrors } from '../../lib/forms';
import { useClients } from '../clients/useClients';
import { isLogLevel, LOG_LEVEL_INFO, LOG_LEVEL_OPTIONS } from '../logs/logFormat';
import { SeverityBadge } from '../monitoring/MonitoringBadges';
import { isSeverity, SEVERITY_OPTIONS } from '../monitoring/monitoringFormat';

const COLUMNS = 7;

export function LogAlertRulesSection() {
  const queryClient = useQueryClient();
  const rules = useQuery({ queryKey: queryKeys.logAlertRules, queryFn: logAlertRulesApi.list });
  const clients = useClients();
  const [editing, setEditing] = useState<{ rule: LogAlertRuleDto | null } | null>(null);
  const clientName = (id: number | null) => (id === null ? 'Todos' : (clients.data?.find((c) => c.id === id)?.name ?? `Cliente ${id}`));

  const remove = useMutation({
    mutationFn: (rule: LogAlertRuleDto) => logAlertRulesApi.remove(rule.id),
    onSuccess: (_, rule) => {
      notifySuccess(`Regra ${rule.name} excluída.`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.logAlertRules });
    },
  });

  return (
    <section aria-labelledby="log-rules-title">
      <Group justify="space-between" mb="xs" align="flex-end">
        <div>
          <Title order={3} id="log-rules-title">
            Regras de alerta de log
          </Title>
          <Text size="sm" c="dimmed">
            Criam um alerta quando uma máquina ou dispositivo atinge o número de ocorrências dentro da janela.
          </Text>
        </div>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing({ rule: null })}>
          Nova regra
        </Button>
      </Group>
      {rules.isError && <LoadError error={rules.error} onRetry={() => void rules.refetch()} />}
      <Paper withBorder>
        <Table.ScrollContainer minWidth={860}>
          <Table striped verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Nome</Table.Th>
                <Table.Th>Cliente</Table.Th>
                <Table.Th>Condição</Table.Th>
                <Table.Th>Ocorrências</Table.Th>
                <Table.Th>Severidade</Table.Th>
                <Table.Th>Situação</Table.Th>
                <Table.Th w={100} aria-label="Ações" />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rules.isPending && <LoadingRows columns={COLUMNS} rows={3} />}
              {rules.isSuccess && rules.data.length === 0 && <EmptyRow columns={COLUMNS} message="Nenhuma regra de alerta de log." />}
              {rules.data?.map((rule) => (
                <Table.Tr key={rule.id}>
                  <Table.Td fw={500}>{rule.name}</Table.Td>
                  <Table.Td>{clientName(rule.clientId)}</Table.Td>
                  <Table.Td>
                    <Text size="sm">Nível {LOG_LEVEL_INFO[rule.minLevel].label.toLowerCase()} ou acima</Text>
                    {rule.sourceContains && (
                      <Text size="xs" c="dimmed">
                        Origem contém “{rule.sourceContains}”
                      </Text>
                    )}
                    {rule.messageContains && (
                      <Text size="xs" c="dimmed">
                        Mensagem contém “{rule.messageContains}”
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {rule.threshold} em {rule.windowMinutes} min
                  </Table.Td>
                  <Table.Td>
                    <SeverityBadge severity={rule.severity} />
                  </Table.Td>
                  <Table.Td>
                    <Badge color={rule.enabled ? 'teal' : 'gray'} variant="light">
                      {rule.enabled ? 'Ativa' : 'Inativa'}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap="nowrap" justify="flex-end">
                      <Tooltip label="Editar">
                        <ActionIcon variant="subtle" color="gray" aria-label={`Editar regra ${rule.name}`} onClick={() => setEditing({ rule })}>
                          <IconPencil size={16} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Excluir">
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          aria-label={`Excluir regra ${rule.name}`}
                          onClick={() =>
                            confirmAction({
                              title: 'Excluir regra',
                              message: `Excluir a regra ${rule.name}?`,
                              confirmLabel: 'Excluir',
                              danger: true,
                              onConfirm: () => remove.mutate(rule),
                            })
                          }
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
      <Modal opened={editing !== null} onClose={() => setEditing(null)} title={editing?.rule ? 'Editar regra de alerta de log' : 'Nova regra de alerta de log'} size="lg" centered>
        {editing && (
          <RuleForm
            key={editing.rule?.id ?? 'nova'}
            rule={editing.rule}
            clientOptions={(clients.data ?? []).map((c) => ({ value: String(c.id), label: c.name }))}
            onClose={() => setEditing(null)}
          />
        )}
      </Modal>
    </section>
  );
}

interface RuleFormValues {
  name: string;
  clientId: string | null;
  minLevel: LogLevel;
  sourceContains: string;
  messageContains: string;
  threshold: number | string;
  windowMinutes: number | string;
  severity: Severity;
  enabled: boolean;
}

function RuleForm({ rule, clientOptions, onClose }: { rule: LogAlertRuleDto | null; clientOptions: { value: string; label: string }[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const form = useForm<RuleFormValues>({
    initialValues: {
      name: rule?.name ?? '',
      clientId: rule?.clientId ? String(rule.clientId) : null,
      minLevel: rule?.minLevel ?? 'error',
      sourceContains: rule?.sourceContains ?? '',
      messageContains: rule?.messageContains ?? '',
      threshold: rule?.threshold ?? 1,
      windowMinutes: rule?.windowMinutes ?? 10,
      severity: rule?.severity ?? 'warning',
      enabled: rule?.enabled ?? true,
    },
    validate: {
      name: (v) => (v.trim() ? null : 'Informe o nome'),
      threshold: (v) => (Number.isInteger(Number(v)) && Number(v) >= 1 ? null : 'Informe ao menos 1 ocorrência'),
      windowMinutes: (v) => (Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 1440 ? null : 'Entre 1 e 1440 minutos'),
    },
  });
  const save = useMutation({
    mutationFn: (body: SaveLogAlertRuleRequest) => (rule ? logAlertRulesApi.update(rule.id, body) : logAlertRulesApi.create(body)),
    onSuccess: async () => {
      notifySuccess(rule ? 'Regra atualizada.' : 'Regra criada.');
      await queryClient.invalidateQueries({ queryKey: queryKeys.logAlertRules });
      onClose();
    },
    onError: (error) => applyServerErrors(form, error),
  });

  return (
    <form
      onSubmit={form.onSubmit((v) =>
        save.mutate({
          name: v.name.trim(),
          clientId: v.clientId ? Number(v.clientId) : null,
          minLevel: v.minLevel,
          sourceContains: v.sourceContains.trim() || null,
          messageContains: v.messageContains.trim() || null,
          threshold: Number(v.threshold),
          windowMinutes: Number(v.windowMinutes),
          severity: v.severity,
          enabled: v.enabled,
        }),
      )}
      noValidate
    >
      <Stack>
        <TextInput label="Nome" required data-autofocus {...form.getInputProps('name')} />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Select label="Cliente" placeholder="Todos os clientes" clearable searchable data={clientOptions} {...form.getInputProps('clientId')} />
          <Select
            label="Nível mínimo"
            data={LOG_LEVEL_OPTIONS}
            value={form.values.minLevel}
            onChange={(v) => isLogLevel(v) && form.setFieldValue('minLevel', v)}
            allowDeselect={false}
          />
          <TextInput label="Origem contém" placeholder="Opcional" {...form.getInputProps('sourceContains')} />
          <TextInput label="Mensagem contém" placeholder="Opcional" {...form.getInputProps('messageContains')} />
          <NumberInput label="Ocorrências" min={1} allowDecimal={false} {...form.getInputProps('threshold')} />
          <NumberInput label="Janela (minutos)" min={1} max={1440} allowDecimal={false} {...form.getInputProps('windowMinutes')} />
          <Select
            label="Severidade do alerta"
            data={SEVERITY_OPTIONS}
            value={form.values.severity}
            onChange={(v) => isSeverity(v) && form.setFieldValue('severity', v)}
            allowDeselect={false}
          />
        </SimpleGrid>
        <Switch label="Regra ativa" {...form.getInputProps('enabled', { type: 'checkbox' })} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            {rule ? 'Salvar' : 'Criar'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
