import { Button, Center, Group, Loader, Modal, Select, Stack, Text } from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { deploymentsApi } from '../../api/deployments';
import { queryKeys } from '../../api/queryKeys';
import type { ClientDto, GoArch, InstallerAgentType } from '../../api/types';
import { LoadError } from '../../components/TableStates';
import { notifySuccess } from '../../lib/feedback';
import { applyServerErrors } from '../../lib/forms';
import { agentTypeOptions, ARCH_OPTIONS, initialSite, isAgentType, isArch } from '../agents/installOptions';
import { siteSelectGroups, useClients } from '../clients/useClients';

interface CreateDeploymentModalProps {
  opened: boolean;
  onClose: () => void;
}

export function CreateDeploymentModal({ opened, onClose }: CreateDeploymentModalProps) {
  const clients = useClients(opened);
  let content = null;
  if (opened) {
    if (clients.isError) content = <LoadError error={clients.error} onRetry={() => void clients.refetch()} />;
    else if (!clients.data)
      content = (
        <Center py="xl">
          <Loader aria-label="Carregando clientes" />
        </Center>
      );
    else if (clients.data.length === 0) content = <Text c="dimmed">Cadastre um cliente e um site antes de criar implantações.</Text>;
    else content = <DeploymentForm clients={clients.data} onClose={onClose} />;
  }
  return (
    <Modal opened={opened} onClose={onClose} title="Nova implantação" centered>
      {content}
    </Modal>
  );
}

interface FormValues {
  siteId: string | null;
  agentType: InstallerAgentType;
  goarch: GoArch;
  expiresAt: string | null;
}

function DeploymentForm({ clients, onClose }: { clients: ClientDto[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const form = useForm<FormValues>({
    initialValues: {
      siteId: initialSite(clients).siteId,
      agentType: 'auto',
      goarch: 'amd64',
      expiresAt: dayjs().add(7, 'day').format('YYYY-MM-DD HH:mm:ss'),
    },
    validate: {
      siteId: (v) => (v ? null : 'Escolha o site'),
      expiresAt: (v) => (v && dayjs(v).isAfter(dayjs()) ? null : 'Escolha uma data futura'),
    },
  });
  const create = useMutation({
    mutationFn: (values: FormValues) =>
      deploymentsApi.create({
        siteId: Number(values.siteId),
        agentType: values.agentType,
        goarch: values.goarch,
        expiresAt: dayjs(values.expiresAt).toISOString(),
      }),
    onSuccess: async () => {
      notifySuccess('Implantação criada.');
      await queryClient.invalidateQueries({ queryKey: queryKeys.deployments });
      onClose();
    },
    onError: (error) => applyServerErrors(form, error),
  });

  return (
    <form onSubmit={form.onSubmit((values) => create.mutate(values))} noValidate>
      <Stack>
        <Select label="Site" required searchable data={siteSelectGroups(clients)} {...form.getInputProps('siteId')} />
        <Select
          label="Tipo"
          required
          allowDeselect={false}
          description="Detectar automaticamente vale para Linux; no Windows e no macOS a máquina é cadastrada como estação."
          data={agentTypeOptions('all')}
          value={form.values.agentType}
          onChange={(value) => {
            if (isAgentType(value)) form.setFieldValue('agentType', value);
          }}
        />
        <Select
          label="Arquitetura"
          required
          allowDeselect={false}
          data={ARCH_OPTIONS}
          value={form.values.goarch}
          onChange={(value) => {
            if (isArch(value)) form.setFieldValue('goarch', value);
          }}
        />
        <DateTimePicker
          label="Válida até"
          required
          valueFormat="DD/MM/YYYY HH:mm"
          minDate={dayjs().format('YYYY-MM-DD HH:mm:ss')}
          {...form.getInputProps('expiresAt')}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={create.isPending}>
            Criar implantação
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
