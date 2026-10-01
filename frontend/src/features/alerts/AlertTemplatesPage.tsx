import { Fragment, useState } from 'react';
import {
  ActionIcon,
  Anchor,
  Breadcrumbs,
  Button,
  Checkbox,
  Divider,
  Group,
  Modal,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  TagsInput,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { alertTemplatesApi } from '../../api/alerts';
import { queryKeys } from '../../api/queryKeys';
import type { AlertTemplateDto, SaveAlertTemplateRequest, Severity, TemplateAssignmentRequest } from '../../api/types';
import { PATHS } from '../../app/paths';
import { PageHeader } from '../../components/PageHeader';
import { EmptyRow, LoadError, LoadingRows } from '../../components/TableStates';
import { confirmAction, notifySuccess } from '../../lib/feedback';
import { applyServerErrors } from '../../lib/forms';
import { SeverityBadge } from '../monitoring/MonitoringBadges';
import { SEVERITIES, SEVERITY_INFO } from '../monitoring/monitoringFormat';

const COLUMNS = 5;
const NONE = 'none';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function SeverityList({ severities }: { severities: Severity[] }) {
  if (severities.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        Desligado
      </Text>
    );
  }
  return (
    <Group gap={4}>
      {SEVERITIES.filter((s) => severities.includes(s)).map((s) => (
        <SeverityBadge key={s} severity={s} size="xs" />
      ))}
    </Group>
  );
}

export function AlertTemplatesPage() {
  const queryClient = useQueryClient();
  const templates = useQuery({ queryKey: queryKeys.alertTemplates, queryFn: alertTemplatesApi.list });
  const [editing, setEditing] = useState<{ template: AlertTemplateDto | null } | null>(null);
  const remove = useMutation({
    mutationFn: (t: AlertTemplateDto) => alertTemplatesApi.remove(t.id),
    onSuccess: (_, t) => {
      notifySuccess(`Template ${t.name} excluído.`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.alertTemplates });
    },
  });

  return (
    <>
      <Breadcrumbs mb="xs">
        <Anchor component={Link} to={PATHS.alerts} size="sm">
          Alertas
        </Anchor>
        <Text size="sm">Templates</Text>
      </Breadcrumbs>
      <PageHeader
        title="Templates de alerta"
        description="Definem quem é notificado e por quais canais. Vale o template mais específico: agente, site, cliente ou global."
        actions={
          <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing({ template: null })}>
            Novo template
          </Button>
        }
      />
      {templates.isError && <LoadError error={templates.error} onRetry={() => void templates.refetch()} />}
      <Paper withBorder mb="xl">
        <Table.ScrollContainer minWidth={820}>
          <Table verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Nome</Table.Th>
                <Table.Th>E-mail</Table.Th>
                <Table.Th>Webhook</Table.Th>
                <Table.Th>Painel</Table.Th>
                <Table.Th w={90} aria-label="Ações" />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {templates.isPending && <LoadingRows columns={COLUMNS} rows={3} />}
              {templates.isSuccess && templates.data.length === 0 && <EmptyRow columns={COLUMNS} message="Nenhum template cadastrado." />}
              {templates.data?.map((t) => (
                <Table.Tr key={t.id}>
                  <Table.Td>
                    <Text size="sm" fw={500}>
                      {t.name}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {t.emailRecipients.length
                        ? `${t.emailRecipients.length} ${t.emailRecipients.length === 1 ? 'destinatário' : 'destinatários'}`
                        : 'Sem destinatários'}
                      {t.notifyOnResolved ? ' · avisa quando resolve' : ''}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <SeverityList severities={t.emailSeverities} />
                  </Table.Td>
                  <Table.Td>
                    <SeverityList severities={t.webhookUrl ? t.webhookSeverities : []} />
                  </Table.Td>
                  <Table.Td>
                    <SeverityList severities={t.dashboardSeverities} />
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap="nowrap" justify="flex-end">
                      <Tooltip label="Editar">
                        <ActionIcon variant="subtle" color="gray" aria-label={`Editar template ${t.name}`} onClick={() => setEditing({ template: t })}>
                          <IconPencil size={16} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Excluir">
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          aria-label={`Excluir template ${t.name}`}
                          onClick={() =>
                            confirmAction({
                              title: 'Excluir template',
                              message: `Excluir o template ${t.name}?`,
                              confirmLabel: 'Excluir',
                              danger: true,
                              onConfirm: () => remove.mutate(t),
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
      <TemplateAssignments templates={templates.data ?? []} />
      <Modal
        opened={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.template ? 'Editar template' : 'Novo template'}
        size="lg"
        centered
      >
        {editing && <TemplateForm key={editing.template?.id ?? 'novo'} current={editing.template} onClose={() => setEditing(null)} />}
      </Modal>
    </>
  );
}

function SeverityChecks({ label, value, onChange, disabled }: { label: string; value: Severity[]; onChange: (v: Severity[]) => void; disabled?: boolean }) {
  return (
    <Checkbox.Group label={label} value={value} onChange={(v) => onChange(SEVERITIES.filter((s) => v.includes(s)))}>
      <Stack gap={6} mt={6}>
        {SEVERITIES.map((s) => (
          <Checkbox key={s} value={s} label={SEVERITY_INFO[s].label} disabled={disabled} />
        ))}
      </Stack>
    </Checkbox.Group>
  );
}

function TemplateForm({ current, onClose }: { current: AlertTemplateDto | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const form = useForm<SaveAlertTemplateRequest>({
    initialValues: {
      name: current?.name ?? '',
      emailRecipients: current?.emailRecipients ?? [],
      webhookUrl: current?.webhookUrl ?? '',
      emailSeverities: current?.emailSeverities ?? ['error'],
      webhookSeverities: current?.webhookSeverities ?? ['error'],
      dashboardSeverities: current?.dashboardSeverities ?? ['info', 'warning', 'error'],
      notifyOnResolved: current?.notifyOnResolved ?? false,
      agentOverdueEmail: current?.agentOverdueEmail ?? false,
      agentOverdueWebhook: current?.agentOverdueWebhook ?? false,
      agentOverdueDashboard: current?.agentOverdueDashboard ?? true,
    },
    validate: {
      name: (v) => (v.trim() ? null : 'Informe o nome'),
      emailRecipients: (v) => (v.every((e) => EMAIL_PATTERN.test(e.trim())) ? null : 'Há endereços de e-mail inválidos'),
      webhookUrl: (v) => (!v || /^https?:\/\/\S+$/i.test(v.trim()) ? null : 'Use uma URL http ou https'),
    },
  });
  const save = useMutation({
    mutationFn: (body: SaveAlertTemplateRequest) => (current ? alertTemplatesApi.update(current.id, body) : alertTemplatesApi.create(body)),
    onSuccess: async () => {
      notifySuccess(current ? 'Template atualizado.' : 'Template criado.');
      await queryClient.invalidateQueries({ queryKey: queryKeys.alertTemplates });
      onClose();
    },
    onError: (error) => applyServerErrors(form, error),
  });
  const v = form.values;
  return (
    <form
      onSubmit={form.onSubmit((values) =>
        save.mutate({
          ...values,
          name: values.name.trim(),
          emailRecipients: values.emailRecipients.map((e) => e.trim()).filter(Boolean),
          webhookUrl: values.webhookUrl?.trim() ? values.webhookUrl.trim() : null,
        }),
      )}
      noValidate
    >
      <Stack>
        <TextInput label="Nome" required data-autofocus {...form.getInputProps('name')} />
        <TagsInput
          label="Destinatários de e-mail"
          description="Digite o endereço e tecle Enter"
          placeholder="tecnico@empresa.com.br"
          {...form.getInputProps('emailRecipients')}
        />
        <TextInput label="URL do webhook" placeholder="https://..." description="Vazio usa o webhook padrão das configurações" {...form.getInputProps('webhookUrl')} />
        <Divider label="Severidades notificadas por canal" labelPosition="left" />
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <SeverityChecks label="E-mail" value={v.emailSeverities} onChange={(s) => form.setFieldValue('emailSeverities', s)} />
          <SeverityChecks label="Webhook" value={v.webhookSeverities} onChange={(s) => form.setFieldValue('webhookSeverities', s)} />
          <SeverityChecks label="Painel" value={v.dashboardSeverities} onChange={(s) => form.setFieldValue('dashboardSeverities', s)} />
        </SimpleGrid>
        <Switch label="Notificar também quando o alerta for resolvido" {...form.getInputProps('notifyOnResolved', { type: 'checkbox' })} />
        <Divider label="Agente em atraso" labelPosition="left" />
        <Group gap="xl">
          <Switch label="E-mail" {...form.getInputProps('agentOverdueEmail', { type: 'checkbox' })} />
          <Switch label="Webhook" {...form.getInputProps('agentOverdueWebhook', { type: 'checkbox' })} />
          <Switch label="Painel" {...form.getInputProps('agentOverdueDashboard', { type: 'checkbox' })} />
        </Group>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            {current ? 'Salvar' : 'Criar'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

function TemplateSelect({ label, value, options, disabled, onChange, compact }: {
  label: string;
  value: number | null;
  options: { value: string; label: string }[];
  disabled: boolean;
  onChange: (id: number | null) => void;
  compact?: boolean;
}) {
  return (
    <Select
      label={compact ? undefined : label}
      aria-label={label}
      size={compact ? 'xs' : 'sm'}
      allowDeselect={false}
      data={[{ value: NONE, label: compact ? 'Herdar' : 'Nenhum' }, ...options]}
      value={value === null ? NONE : String(value)}
      disabled={disabled}
      onChange={(v) => {
        const next = !v || v === NONE ? null : Number(v);
        if (next !== value) onChange(next);
      }}
    />
  );
}

function TemplateAssignments({ templates }: { templates: AlertTemplateDto[] }) {
  const queryClient = useQueryClient();
  const assignments = useQuery({ queryKey: queryKeys.alertTemplateAssignments, queryFn: alertTemplatesApi.assignments });
  const assign = useMutation({
    mutationFn: (body: TemplateAssignmentRequest) => alertTemplatesApi.assign(body),
    onSuccess: () => {
      notifySuccess('Atribuição do template salva.');
      void queryClient.invalidateQueries({ queryKey: queryKeys.alertTemplateAssignments });
    },
    onError: () => void assignments.refetch(),
  });
  const options = templates.map((t) => ({ value: String(t.id), label: t.name }));
  const data = assignments.data;
  const disabled = assign.isPending || !data;
  const set = (target: TemplateAssignmentRequest['target'], targetId: number | null) => (templateId: number | null) =>
    assign.mutate({ target, targetId, templateId });

  return (
    <section aria-labelledby="atribuicoes-templates">
      <Title order={3} id="atribuicoes-templates" mb="xs">
        Atribuições
      </Title>
      {assignments.isError && <LoadError error={assignments.error} onRetry={() => void assignments.refetch()} />}
      <Paper withBorder p="md" mb="md">
        <TemplateSelect label="Template global" value={data?.global ?? null} options={options} disabled={disabled} onChange={set('global', null)} />
      </Paper>
      <Paper withBorder>
        <Table.ScrollContainer minWidth={560}>
          <Table verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Cliente ou site</Table.Th>
                <Table.Th w={260}>Template</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {assignments.isPending && <LoadingRows columns={2} rows={3} />}
              {data && data.clients.length === 0 && <EmptyRow columns={2} message="Nenhum cliente cadastrado." />}
              {data?.clients.map((client) => (
                <Fragment key={client.id}>
                  <Table.Tr bg="var(--mantine-color-default-hover)">
                    <Table.Td fw={600}>{client.name}</Table.Td>
                    <Table.Td>
                      <TemplateSelect
                        compact
                        label={`Template do cliente ${client.name}`}
                        value={client.alertTemplateId}
                        options={options}
                        disabled={disabled}
                        onChange={set('client', client.id)}
                      />
                    </Table.Td>
                  </Table.Tr>
                  {data.sites
                    .filter((s) => s.clientId === client.id)
                    .map((site) => (
                      <Table.Tr key={`site-${site.id}`}>
                        <Table.Td pl="xl">{site.name}</Table.Td>
                        <Table.Td>
                          <TemplateSelect
                            compact
                            label={`Template do site ${site.name}`}
                            value={site.alertTemplateId}
                            options={options}
                            disabled={disabled}
                            onChange={set('site', site.id)}
                          />
                        </Table.Td>
                      </Table.Tr>
                    ))}
                </Fragment>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
    </section>
  );
}
