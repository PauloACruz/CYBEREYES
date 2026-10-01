import { useState } from 'react';
import {
  ActionIcon,
  Alert,
  Button,
  Center,
  Code,
  CopyButton,
  Group,
  Input,
  Loader,
  Modal,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconCheck, IconCopy, IconInfoCircle, IconTerminal2 } from '@tabler/icons-react';
import { useMutation } from '@tanstack/react-query';
import { agentsApi } from '../../api/agents';
import type { AgentPlat, ClientDto, GoArch, InstallerAgentType, InstallerResponse } from '../../api/types';
import { LoadError } from '../../components/TableStates';
import { formatDateTime } from '../../lib/format';
import { applyServerErrors } from '../../lib/forms';
import { useClients } from '../clients/useClients';
import {
  agentTypeOptions,
  ARCH_OPTIONS,
  defaultAgentType,
  defaultArch,
  initialSite,
  isAgentType,
  isArch,
  isPlat,
  PLAT_OPTIONS,
} from './installOptions';

interface InstallAgentModalProps {
  opened: boolean;
  onClose: () => void;
}

export function InstallAgentModal({ opened, onClose }: InstallAgentModalProps) {
  const [result, setResult] = useState<InstallerResponse | null>(null);
  const clients = useClients(opened);
  const close = () => {
    setResult(null);
    onClose();
  };

  let content = null;
  if (opened) {
    if (result) content = <InstallerResult result={result} onBack={() => setResult(null)} onDone={close} />;
    else if (clients.isError) content = <LoadError error={clients.error} onRetry={() => void clients.refetch()} />;
    else if (!clients.data)
      content = (
        <Center py="xl">
          <Loader aria-label="Carregando clientes" />
        </Center>
      );
    else if (clients.data.length === 0)
      content = <Text c="dimmed">Cadastre um cliente e um site antes de instalar agentes.</Text>;
    else content = <InstallerForm clients={clients.data} onGenerated={setResult} onCancel={close} />;
  }

  return (
    <Modal opened={opened} onClose={close} title="Instalar agente" centered size="lg">
      {content}
    </Modal>
  );
}

interface FormValues {
  clientId: string | null;
  siteId: string | null;
  plat: AgentPlat;
  agentType: InstallerAgentType;
  goarch: GoArch;
  expiresHours: number | string;
}

function InstallerForm({
  clients,
  onGenerated,
  onCancel,
}: {
  clients: ClientDto[];
  onGenerated: (result: InstallerResponse) => void;
  onCancel: () => void;
}) {
  const form = useForm<FormValues>({
    initialValues: { ...initialSite(clients), plat: 'windows', agentType: 'workstation', goarch: 'amd64', expiresHours: 24 },
    validate: {
      clientId: (v) => (v ? null : 'Escolha o cliente'),
      siteId: (v) => (v ? null : 'Escolha o site'),
      expiresHours: (v) => {
        const n = Number(v);
        return Number.isInteger(n) && n >= 1 && n <= 720 ? null : 'Informe de 1 a 720 horas';
      },
    },
  });
  const generate = useMutation({
    mutationFn: (values: FormValues) =>
      agentsApi.installer({
        siteId: Number(values.siteId),
        agentType: values.agentType,
        plat: values.plat,
        goarch: values.goarch,
        expiresHours: Number(values.expiresHours),
      }),
    onSuccess: onGenerated,
    onError: (error) => applyServerErrors(form, error),
  });

  const client = clients.find((c) => String(c.id) === form.values.clientId);
  const siteOptions = (client?.sites ?? []).map((s) => ({ value: String(s.id), label: s.name }));

  return (
    <form onSubmit={form.onSubmit((values) => generate.mutate(values))} noValidate>
      <Stack>
        <Group grow align="flex-start">
          <Select
            label="Cliente"
            required
            searchable
            data={clients.map((c) => ({ value: String(c.id), label: c.name }))}
            {...form.getInputProps('clientId')}
            onChange={(value: string | null) => {
              const next = clients.find((c) => String(c.id) === value);
              const onlySite = next?.sites.length === 1 ? next.sites[0] : undefined;
              form.setValues({ clientId: value, siteId: onlySite ? String(onlySite.id) : null });
            }}
          />
          <Select
            label="Site"
            required
            searchable
            data={siteOptions}
            disabled={!client}
            placeholder={client ? undefined : 'Escolha o cliente'}
            {...form.getInputProps('siteId')}
          />
        </Group>
        <Input.Wrapper label="Sistema" required>
          <SegmentedControl
            fullWidth
            mt={4}
            data={PLAT_OPTIONS}
            value={form.values.plat}
            onChange={(value) => {
              if (!isPlat(value)) return;
              form.setValues({ plat: value, agentType: defaultAgentType(value), goarch: defaultArch(value) });
            }}
          />
        </Input.Wrapper>
        <Group grow align="flex-start">
          <Select
            label="Tipo"
            required
            allowDeselect={false}
            description={
              form.values.plat === 'linux' && form.values.agentType === 'auto'
                ? 'Estação se houver interface gráfica; servidor se houver só terminal.'
                : undefined
            }
            data={agentTypeOptions(form.values.plat)}
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
        </Group>
        <NumberInput
          label="Validade (horas)"
          description="Depois desse prazo o comando deixa de funcionar. De 1 a 720 horas."
          required
          min={1}
          max={720}
          allowDecimal={false}
          {...form.getInputProps('expiresHours')}
        />
        <Group justify="flex-end" mt="sm">
          <Button variant="default" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" loading={generate.isPending}>
            Gerar comando
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

const PLAT_NOTE: Record<AgentPlat, string> = {
  windows: 'Abra o PowerShell como administrador na máquina e cole o comando.',
  linux:
    'Rode no terminal com um usuário que tenha sudo. Com o tipo "Detectar automaticamente", a máquina é cadastrada como estação quando tem interface gráfica e como servidor quando tem só terminal.',
  darwin: 'Rode no Terminal com um usuário administrador (o comando usa sudo).',
};

function InstallerResult({ result, onBack, onDone }: { result: InstallerResponse; onBack: () => void; onDone: () => void }) {
  return (
    <Stack>
      <Group justify="space-between" align="center">
        <Group gap={6}>
          <IconTerminal2 size={18} aria-hidden />
          <Text fw={500}>Comando de instalação</Text>
        </Group>
        <CopyButton value={result.command} timeout={2000}>
          {({ copied, copy }) => (
            <Tooltip label={copied ? 'Copiado' : 'Copiar comando'} withArrow>
              <ActionIcon color={copied ? 'teal' : 'gray'} variant="light" onClick={copy} aria-label="Copiar comando">
                {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
              </ActionIcon>
            </Tooltip>
          )}
        </CopyButton>
      </Group>
      <Code block style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }} data-testid="installer-command">
        {result.command}
      </Code>
      <Text size="sm" c="dimmed">
        Válido até {formatDateTime(result.expiresAt)}.
      </Text>
      <Alert color="blue" variant="light" icon={<IconInfoCircle size={18} />}>
        {PLAT_NOTE[result.plat]}
      </Alert>
      <Group justify="flex-end">
        <Button variant="default" onClick={onBack}>
          Gerar outro
        </Button>
        <Button onClick={onDone}>Concluir</Button>
      </Group>
    </Stack>
  );
}
