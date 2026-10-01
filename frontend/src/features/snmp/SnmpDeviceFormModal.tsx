import { useState } from 'react';
import {
  Alert,
  Button,
  Divider,
  Group,
  Modal,
  NumberInput,
  PasswordInput,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconCircleCheck, IconPlugConnected, IconPlugConnectedX } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../api/client';
import { queryKeys } from '../../api/queryKeys';
import { snmpApi } from '../../api/snmp';
import {
  PERMISSIONS,
  type SaveSnmpDeviceRequest,
  type SnmpAuthProtocol,
  type SnmpDeviceDto,
  type SnmpPrivProtocol,
  type SnmpSecurityLevel,
  type SnmpTestResult,
  type SnmpTrapSeverity,
  type SnmpVersion,
} from '../../api/types';
import { hasPermission } from '../../auth/permissions';
import { useMe } from '../../auth/useMe';
import { notifySuccess } from '../../lib/feedback';
import { applyServerErrors } from '../../lib/forms';
import { useClients } from '../clients/useClients';
import { AssetSearchSelect } from '../inventory/AssetSearchSelect';
import {
  AUTH_PROTOCOLS,
  isAuthProtocol,
  isPrivProtocol,
  isSecurityLevel,
  isTrapSeverity,
  PRIV_PROTOCOLS,
  SECURITY_LEVEL_OPTIONS,
  TRAP_SEVERITY_OPTIONS,
} from './snmpFormat';

const KEEP_HINT = 'Deixe em branco para manter';

interface FormValues {
  clientId: string | null;
  siteId: string | null;
  collectorAgentId: string | null;
  assetId: string | null;
  name: string;
  host: string;
  port: number | string;
  version: SnmpVersion;
  community: string;
  username: string;
  securityLevel: SnmpSecurityLevel;
  authProtocol: SnmpAuthProtocol;
  authPassword: string;
  privProtocol: SnmpPrivProtocol;
  privPassword: string;
  interval: number | string;
  timeout: number | string;
  retries: number | string;
  pollInterfaces: boolean;
  enabled: boolean;
  trapSeverity: SnmpTrapSeverity;
}

function initialValues(device: SnmpDeviceDto | null): FormValues {
  return {
    clientId: device ? String(device.clientId) : null,
    siteId: device?.siteId ? String(device.siteId) : null,
    collectorAgentId: device ? String(device.collectorAgentId) : null,
    assetId: device?.assetId ? String(device.assetId) : null,
    name: device?.name ?? '',
    host: device?.host ?? '',
    port: device?.port ?? 161,
    version: device?.version ?? 'v2c',
    community: '',
    username: device?.v3?.username ?? '',
    securityLevel: device?.v3?.securityLevel ?? 'authPriv',
    authProtocol: device?.v3?.authProtocol ?? 'SHA256',
    authPassword: '',
    privProtocol: device?.v3?.privProtocol ?? 'AES',
    privPassword: '',
    interval: device?.interval ?? 300,
    timeout: device?.timeout ?? 5,
    retries: device?.retries ?? 1,
    pollInterfaces: device?.pollInterfaces ?? true,
    enabled: device?.enabled ?? true,
    trapSeverity: device?.trapSeverity ?? 'warning',
  };
}

function toNumber(value: number | string): number {
  return typeof value === 'number' ? value : Number(value);
}

function inRange(value: number | string, min: number, max: number, message: string): string | null {
  const n = toNumber(value);
  return Number.isInteger(n) && n >= min && n <= max ? null : message;
}

function toRequest(values: FormValues): SaveSnmpDeviceRequest {
  const body: SaveSnmpDeviceRequest = {
    clientId: Number(values.clientId),
    siteId: values.siteId ? Number(values.siteId) : null,
    collectorAgentId: Number(values.collectorAgentId),
    assetId: values.assetId ? Number(values.assetId) : null,
    name: values.name.trim(),
    host: values.host.trim(),
    port: toNumber(values.port),
    version: values.version,
    interval: toNumber(values.interval),
    timeout: toNumber(values.timeout),
    retries: toNumber(values.retries),
    pollInterfaces: values.pollInterfaces,
    enabled: values.enabled,
    trapSeverity: values.trapSeverity,
  };
  // Credenciais so quando digitadas: no PUT, ausentes mantem as atuais.
  if (values.version === 'v2c') {
    if (values.community) body.community = values.community;
    return body;
  }
  const auth = values.securityLevel !== 'noAuthNoPriv';
  const priv = values.securityLevel === 'authPriv';
  body.v3 = {
    securityLevel: values.securityLevel,
    ...(values.username.trim() ? { username: values.username.trim() } : {}),
    ...(auth ? { authProtocol: values.authProtocol } : {}),
    ...(auth && values.authPassword ? { authPassword: values.authPassword } : {}),
    ...(priv ? { privProtocol: values.privProtocol } : {}),
    ...(priv && values.privPassword ? { privPassword: values.privPassword } : {}),
  };
  return body;
}

interface SnmpDeviceFormModalProps {
  opened: boolean;
  onClose: () => void;
  device: SnmpDeviceDto | null;
}

export function SnmpDeviceFormModal({ opened, onClose, device }: SnmpDeviceFormModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} title={device ? `Editar ${device.name}` : 'Novo dispositivo SNMP'} size="xl" centered>
      {opened && <SnmpDeviceForm key={device?.id ?? 'novo'} device={device} onClose={onClose} />}
    </Modal>
  );
}

function SnmpDeviceForm({ device, onClose }: { device: SnmpDeviceDto | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const canViewInventory = hasPermission(me, PERMISSIONS.inventoryView);
  const clients = useClients();
  const collectors = useQuery({ queryKey: queryKeys.snmpCollectors, queryFn: () => snmpApi.collectors() });
  const [testResult, setTestResult] = useState<{ result: SnmpTestResult } | { error: string } | null>(null);
  // Credenciais salvas so valem se a versao nao mudou.
  const keeps = (version: SnmpVersion) => device !== null && device.hasCredentials && device.version === version;
  // Senhas v3 so ficam se o nivel salvo ja as tinha (sem o nivel salvo, o servidor decide).
  const savedLevel = device?.v3?.securityLevel;
  const keepsAuth = keeps('v3') && savedLevel !== 'noAuthNoPriv';
  const keepsPriv = keeps('v3') && (savedLevel === undefined || savedLevel === 'authPriv');

  const form = useForm<FormValues>({
    initialValues: initialValues(device),
    validate: {
      clientId: (v) => (v ? null : 'Escolha o cliente'),
      collectorAgentId: (v) => (v ? null : 'Escolha o coletor'),
      name: (v) => (v.trim() ? null : 'Informe o nome'),
      host: (v) => (v.trim() ? null : 'Informe o endereço'),
      port: (v) => inRange(v, 1, 65535, 'Porta entre 1 e 65535'),
      interval: (v) => inRange(v, 60, 3600, 'Intervalo entre 60 e 3600 segundos'),
      timeout: (v) => inRange(v, 1, 60, 'Tempo limite entre 1 e 60 segundos'),
      retries: (v) => inRange(v, 0, 5, 'Tentativas entre 0 e 5'),
      community: (v, values) => (values.version === 'v2c' && !v && !keeps('v2c') ? 'Informe a comunidade' : null),
      username: (v, values) => (values.version === 'v3' && !v.trim() ? 'Informe o usuário' : null),
      authPassword: (v, values) => {
        if (values.version !== 'v3' || values.securityLevel === 'noAuthNoPriv') return null;
        if (!v) return keepsAuth ? null : 'Informe a senha de autenticação';
        return v.length >= 8 ? null : 'Mínimo de 8 caracteres';
      },
      privPassword: (v, values) => {
        if (values.version !== 'v3' || values.securityLevel !== 'authPriv') return null;
        if (!v) return keepsPriv ? null : 'Informe a senha de criptografia';
        return v.length >= 8 ? null : 'Mínimo de 8 caracteres';
      },
    },
  });

  // Erros do servidor em v3.* vao para os campos planos do formulario.
  const serverErrors = {
    setFieldError: (path: string, message: string) => {
      const field = path.replace(/^v3\./, '');
      form.setFieldError(field === 'v3' ? 'username' : field, message);
    },
  };

  const clientId = form.values.clientId ? Number(form.values.clientId) : undefined;
  const client = clients.data?.find((c) => c.id === clientId);
  const collectorOptions = (collectors.data ?? [])
    .filter((c) => c.clientId === clientId)
    .map((c) => ({ value: String(c.agentId), label: `${c.hostname}${c.status === 'online' ? '' : ' (offline)'}` }));
  if (device && clientId === device.clientId && !collectorOptions.some((o) => o.value === String(device.collectorAgentId))) {
    collectorOptions.unshift({ value: String(device.collectorAgentId), label: device.collectorHostname ?? `Agente ${device.collectorAgentId}` });
  }

  const save = useMutation({
    mutationFn: (body: SaveSnmpDeviceRequest) => (device ? snmpApi.update(device.id, body) : snmpApi.create(body)),
    onSuccess: async () => {
      notifySuccess(device ? 'Dispositivo atualizado.' : 'Dispositivo criado.');
      await queryClient.invalidateQueries({ queryKey: queryKeys.snmp });
      onClose();
    },
    onError: (error) => applyServerErrors(serverErrors, error),
  });

  const test = useMutation({
    mutationFn: (body: SaveSnmpDeviceRequest) => snmpApi.test(device ? { ...body, id: device.id } : body),
    onMutate: () => setTestResult(null),
    onSuccess: (result) => setTestResult({ result }),
    onError: (error) => {
      const message =
        error instanceof ApiError && error.status === 504
          ? 'O coletor não respondeu a tempo. Verifique se ele está online.'
          : error instanceof ApiError
            ? error.title
            : 'Não foi possível testar a conexão.';
      setTestResult({ error: message });
    },
  });

  const runTest = () => {
    const result = form.validate();
    if (result.hasErrors) return;
    test.mutate(toRequest(form.values));
  };

  const v3 = form.values.version === 'v3';
  const auth = v3 && form.values.securityLevel !== 'noAuthNoPriv';
  const priv = v3 && form.values.securityLevel === 'authPriv';
  const communityHint = keeps('v2c') ? KEEP_HINT : undefined;

  return (
    <form onSubmit={form.onSubmit((values) => save.mutate(toRequest(values)))} noValidate>
      <Stack gap="md">
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Select
            label="Cliente"
            required
            searchable
            data={(clients.data ?? []).map((c) => ({ value: String(c.id), label: c.name }))}
            {...form.getInputProps('clientId')}
            onChange={(v: string | null) => {
              form.setFieldValue('clientId', v);
              form.setFieldValue('siteId', null);
              form.setFieldValue('collectorAgentId', null);
              form.setFieldValue('assetId', null);
            }}
          />
          <Select
            label="Site"
            placeholder="Opcional"
            clearable
            disabled={!client}
            data={(client?.sites ?? []).map((s) => ({ value: String(s.id), label: s.name }))}
            {...form.getInputProps('siteId')}
          />
          <Select
            label="Coletor"
            description="Agente do cliente marcado como coletor SNMP"
            required
            disabled={!client}
            data={collectorOptions}
            nothingFoundMessage="Nenhum coletor neste cliente"
            placeholder={client && collectorOptions.length === 0 ? 'Nenhum coletor neste cliente' : undefined}
            {...form.getInputProps('collectorAgentId')}
          />
          {canViewInventory && (
            <AssetSearchSelect
              key={form.values.clientId ?? 'sem-cliente'}
              label="Ativo do inventário"
              description="Opcional; a ficha do ativo passa a mostrar o status SNMP"
              clientId={clientId}
              disabled={!client}
              value={form.values.assetId}
              currentLabel={device?.assetId ? `Ativo ${device.assetId}` : null}
              onChange={(v) => form.setFieldValue('assetId', v)}
            />
          )}
          <TextInput label="Nome" required data-autofocus {...form.getInputProps('name')} />
          <Group grow align="flex-start" gap="sm">
            <TextInput label="Endereço (IP ou nome)" required {...form.getInputProps('host')} />
            <NumberInput label="Porta" required min={1} max={65535} allowDecimal={false} maw={110} {...form.getInputProps('port')} />
          </Group>
        </SimpleGrid>

        <Divider label="Credenciais" labelPosition="left" />
        <div>
          <Text size="sm" fw={500} mb={4} id="snmp-versao">
            Versão
          </Text>
          <SegmentedControl
            aria-labelledby="snmp-versao"
            data={[
              { value: 'v2c', label: 'v2c' },
              { value: 'v3', label: 'v3' },
            ]}
            value={form.values.version}
            onChange={(v) => form.setFieldValue('version', v === 'v3' ? 'v3' : 'v2c')}
          />
        </div>
        {!v3 && (
          <PasswordInput
            label="Comunidade"
            autoComplete="new-password"
            required={!keeps('v2c')}
            placeholder={communityHint}
            description={communityHint}
            {...form.getInputProps('community')}
          />
        )}
        {v3 && (
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput label="Usuário" required autoComplete="off" {...form.getInputProps('username')} />
            <Select
              label="Nível de segurança"
              data={SECURITY_LEVEL_OPTIONS}
              value={form.values.securityLevel}
              onChange={(v) => isSecurityLevel(v) && form.setFieldValue('securityLevel', v)}
              allowDeselect={false}
            />
            {auth && (
              <>
                <Select
                  label="Protocolo de autenticação"
                  data={[...AUTH_PROTOCOLS]}
                  value={form.values.authProtocol}
                  onChange={(v) => isAuthProtocol(v) && form.setFieldValue('authProtocol', v)}
                  allowDeselect={false}
                />
                <PasswordInput
                  label="Senha de autenticação"
                  autoComplete="new-password"
                  required={!keepsAuth}
                  placeholder={keepsAuth ? KEEP_HINT : undefined}
                  description={keepsAuth ? KEEP_HINT : undefined}
                  {...form.getInputProps('authPassword')}
                />
              </>
            )}
            {priv && (
              <>
                <Select
                  label="Protocolo de criptografia"
                  data={[...PRIV_PROTOCOLS]}
                  value={form.values.privProtocol}
                  onChange={(v) => isPrivProtocol(v) && form.setFieldValue('privProtocol', v)}
                  allowDeselect={false}
                />
                <PasswordInput
                  label="Senha de criptografia"
                  autoComplete="new-password"
                  required={!keepsPriv}
                  placeholder={keepsPriv ? KEEP_HINT : undefined}
                  description={keepsPriv ? KEEP_HINT : undefined}
                  {...form.getInputProps('privPassword')}
                />
              </>
            )}
          </SimpleGrid>
        )}

        <Divider label="Coleta" labelPosition="left" />
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <NumberInput label="Intervalo (segundos)" min={60} max={3600} step={60} allowDecimal={false} {...form.getInputProps('interval')} />
          <NumberInput label="Tempo limite (segundos)" min={1} max={60} allowDecimal={false} {...form.getInputProps('timeout')} />
          <NumberInput label="Tentativas" min={0} max={5} allowDecimal={false} {...form.getInputProps('retries')} />
        </SimpleGrid>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Select
            label="Severidade dos traps"
            description="Alerta criado a cada trap recebido deste dispositivo"
            data={TRAP_SEVERITY_OPTIONS}
            value={form.values.trapSeverity}
            onChange={(v) => isTrapSeverity(v) && form.setFieldValue('trapSeverity', v)}
            allowDeselect={false}
          />
          <Stack gap="xs" justify="flex-end">
            <Switch label="Coletar interfaces" {...form.getInputProps('pollInterfaces', { type: 'checkbox' })} />
            <Switch label="Monitoramento ativo" {...form.getInputProps('enabled', { type: 'checkbox' })} />
          </Stack>
        </SimpleGrid>

        {testResult && 'result' in testResult && testResult.result.reachable && (
          <Alert color="teal" icon={<IconCircleCheck size={18} />} title="Conexão bem-sucedida">
            <Stack gap={2}>
              <Text size="sm">sysName: {testResult.result.system?.name || 'Não informado'}</Text>
              <Text size="sm" style={{ wordBreak: 'break-word' }}>
                sysDescr: {testResult.result.system?.descr || 'Não informado'}
              </Text>
              <Text size="sm">Tempo de resposta: {testResult.result.rttMs !== null ? `${testResult.result.rttMs} ms` : 'Não informado'}</Text>
            </Stack>
          </Alert>
        )}
        {testResult && 'result' in testResult && !testResult.result.reachable && (
          <Alert color="red" icon={<IconPlugConnectedX size={18} />} title="O dispositivo não respondeu">
            {testResult.result.error || 'Sem detalhes do erro.'}
          </Alert>
        )}
        {testResult && 'error' in testResult && (
          <Alert color="red" icon={<IconPlugConnectedX size={18} />} title="Falha no teste">
            {testResult.error}
          </Alert>
        )}

        <Group justify="space-between">
          <Button variant="light" leftSection={<IconPlugConnected size={16} />} loading={test.isPending} onClick={runTest}>
            Testar conexão
          </Button>
          <Group gap="sm">
            <Button variant="default" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={save.isPending}>
              {device ? 'Salvar' : 'Criar'}
            </Button>
          </Group>
        </Group>
      </Stack>
    </form>
  );
}
