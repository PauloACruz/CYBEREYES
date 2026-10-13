import { useState } from 'react';
import {
  Alert,
  Button,
  Code,
  Group,
  Modal,
  NumberInput,
  PasswordInput,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconPlugConnected, IconPlugConnectedX } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { ApiError } from '../../api/client';
import { queryKeys } from '../../api/queryKeys';
import type { AppServerDto, AppServerTestResult, SaveAppServerRequest, SshAuthMethod } from '../../api/types';
import { appServersApi } from '../../api/webapps';
import { appServerPath } from '../../app/paths';
import { notifySuccess } from '../../lib/feedback';
import { applyServerErrors } from '../../lib/forms';
import { useClients } from '../clients/useClients';
import { optional } from '../inventory/inventoryFormat';

const KEEP_HINT = 'Deixe em branco para manter a salva.';
const NEW_PLACE_HINT = 'O endereço mudou: informe a credencial de novo.';

interface ServerFormModalProps {
  opened: boolean;
  onClose: () => void;
  server: AppServerDto | null;
  defaultClientId?: number;
}

export function ServerFormModal({ opened, onClose, server, defaultClientId }: ServerFormModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} title={server ? 'Editar servidor' : 'Novo servidor'} size="lg" centered>
      {opened && <ServerForm onClose={onClose} server={server} defaultClientId={defaultClientId} />}
    </Modal>
  );
}

interface FormValues {
  clientId: string | null;
  name: string;
  host: string;
  port: number | string;
  username: string;
  authMethod: SshAuthMethod;
  password: string;
  privateKey: string;
  passphrase: string;
  provider: string;
  notes: string;
}

function ServerForm({ onClose, server, defaultClientId }: Omit<ServerFormModalProps, 'opened'>) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const clients = useClients();
  const [test, setTest] = useState<(AppServerTestResult & { target: string }) | null>(null);
  const editing = server !== null;
  // Endereco ou porta novos exigem a credencial de novo: a salva nao e enviada a outro servidor.
  const keeps = (values: FormValues, method: SshAuthMethod) =>
    editing &&
    server.authMethod === method &&
    (method === 'key' ? server.hasPrivateKey : server.hasPassword) &&
    values.host.trim().toLowerCase() === server.host.toLowerCase() &&
    Number(values.port) === server.port;
  const form = useForm<FormValues>({
    initialValues: {
      clientId: server ? String(server.clientId) : defaultClientId ? String(defaultClientId) : null,
      name: server?.name ?? '',
      host: server?.host ?? '',
      port: server?.port ?? 22,
      username: server?.username ?? 'root',
      authMethod: server?.authMethod ?? 'key',
      password: '',
      privateKey: '',
      passphrase: '',
      provider: server?.provider ?? '',
      notes: server?.notes ?? '',
    },
    validate: {
      clientId: (v) => (v ? null : 'Escolha o cliente'),
      name: (v) => (v.trim() ? null : 'Informe o nome'),
      host: (v) => {
        const value = v.trim();
        if (!value) return 'Informe o IP ou o nome do servidor';
        return /^[a-z]+:\/\//i.test(value) || /[\s/]/.test(value) ? 'Informe só o IP ou o nome, sem protocolo nem caminho' : null;
      },
      port: (v) => (Number(v) >= 1 && Number(v) <= 65535 ? null : 'Porta entre 1 e 65535'),
      username: (v) => (v.trim() ? null : 'Informe o usuário SSH'),
      password: (v, values) => (values.authMethod === 'password' && !v && !keeps(values, 'password') ? 'Informe a senha' : null),
      privateKey: (v, values) => {
        if (values.authMethod !== 'key') return null;
        if (!v.trim()) return keeps(values, 'key') ? null : 'Cole a chave privada';
        return /-----BEGIN [A-Z ]*PRIVATE KEY-----|PuTTY-User-Key-File/.test(v) ? null : 'Cole a chave completa, com as linhas BEGIN e END';
      },
    },
  });

  const body = (values: FormValues): SaveAppServerRequest => ({
    clientId: Number(values.clientId),
    name: values.name.trim(),
    host: values.host.trim(),
    port: Number(values.port),
    username: values.username.trim(),
    authMethod: values.authMethod,
    password: values.authMethod === 'password' && values.password ? values.password : undefined,
    privateKey: values.authMethod === 'key' && values.privateKey.trim() ? values.privateKey.trim() : undefined,
    passphrase: values.authMethod === 'key' && values.passphrase ? values.passphrase : undefined,
    provider: optional(values.provider),
    notes: optional(values.notes),
  });
  const targetOf = (values: FormValues) => `${values.host.trim()}:${Number(values.port)}`;

  const runTest = useMutation({
    mutationFn: (values: FormValues) => appServersApi.testDraft({ ...body(values), id: server?.id }),
    onSuccess: (result, values) => setTest({ ...result, target: targetOf(values) }),
    onError: (error) => {
      applyServerErrors(form, error);
      setTest(null);
    },
  });

  const save = useMutation({
    mutationFn: (values: FormValues) => {
      const request = body(values);
      // Chave vista no teste deste mesmo endereco: o cadastro ja nasce com ela fixada.
      if (!editing && test?.ok && test.fingerprint && test.target === targetOf(values)) request.hostKeyFingerprint = test.fingerprint;
      return editing ? appServersApi.update(server.id, request) : appServersApi.create(request);
    },
    onSuccess: async (saved) => {
      notifySuccess(editing ? 'Servidor atualizado.' : 'Servidor cadastrado.');
      void queryClient.invalidateQueries({ queryKey: queryKeys.webApps });
      onClose();
      if (!editing) await navigate(appServerPath(saved.id));
    },
    onError: (error) => applyServerErrors(form, error),
  });

  const method = form.values.authMethod;
  const testedHere = test && test.target === targetOf(form.values);

  return (
    <form onSubmit={form.onSubmit((v) => save.mutate(v))} noValidate autoComplete="off">
      <Stack>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label="Nome" required data-autofocus maxLength={200} placeholder="VPS de produção" {...form.getInputProps('name')} />
          <Select
            label="Cliente"
            required
            searchable
            data={(clients.data ?? []).map((c) => ({ value: String(c.id), label: c.name }))}
            {...form.getInputProps('clientId')}
          />
          <TextInput label="IP ou nome do servidor" required placeholder="203.0.113.10" {...form.getInputProps('host')} />
          <SimpleGrid cols={2}>
            <NumberInput label="Porta SSH" required min={1} max={65535} allowDecimal={false} {...form.getInputProps('port')} />
            <TextInput label="Usuário SSH" required maxLength={100} {...form.getInputProps('username')} />
          </SimpleGrid>
        </SimpleGrid>
        <div>
          <Text size="sm" fw={500} mb={4}>
            Autenticação
          </Text>
          <SegmentedControl
            data={[
              { value: 'key', label: 'Chave privada' },
              { value: 'password', label: 'Senha' },
            ]}
            value={method}
            onChange={(v) => form.setFieldValue('authMethod', v === 'password' ? 'password' : 'key')}
            aria-label="Método de autenticação"
          />
        </div>
        {method === 'password' ? (
          <PasswordInput
            label="Senha SSH"
            required={!keeps(form.values, 'password')}
            description={keeps(form.values, 'password') ? KEEP_HINT : editing && server.hasPassword ? NEW_PLACE_HINT : undefined}
            autoComplete="new-password"
            {...form.getInputProps('password')}
          />
        ) : (
          <>
            <Textarea
              label="Chave privada"
              description={
                keeps(form.values, 'key')
                  ? KEEP_HINT
                  : editing && server.hasPrivateKey
                    ? NEW_PLACE_HINT
                    : 'OpenSSH, PEM ou PuTTY (.ppk). Fica cifrada no cofre e só sai dele para conectar ou com a permissão de revelar.'
              }
              placeholder={'-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----'}
              autosize
              minRows={4}
              maxRows={10}
              styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)', fontSize: 12 } }}
              spellCheck={false}
              {...form.getInputProps('privateKey')}
            />
            <PasswordInput
              label="Senha da chave"
              description={editing && server.hasPassphrase ? KEEP_HINT : 'Só se a chave for protegida por senha.'}
              autoComplete="new-password"
              {...form.getInputProps('passphrase')}
            />
          </>
        )}
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label="Provedor" placeholder="Hostinger, AWS, Contabo..." maxLength={100} {...form.getInputProps('provider')} />
        </SimpleGrid>
        <Textarea label="Observações" autosize minRows={2} maxRows={6} {...form.getInputProps('notes')} />

        {testedHere && test.ok && (
          <Alert color="teal" icon={<IconPlugConnected size={18} />} title="Conexão bem-sucedida">
            <Stack gap={6}>
              {test.system && (
                <Code block style={{ whiteSpace: 'pre-wrap' }}>
                  {test.system}
                </Code>
              )}
              {test.fingerprint && (
                <Text size="xs">
                  Chave do servidor ({test.algorithm}): <Code>SHA256:{test.fingerprint}</Code>
                  {!editing && ' — fica fixada ao salvar; se mudar, o Cybereyes recusa a conexão.'}
                </Text>
              )}
            </Stack>
          </Alert>
        )}
        {testedHere && !test.ok && (
          <Alert color="red" icon={<IconPlugConnectedX size={18} />} title="Não conectou">
            {test.error}
          </Alert>
        )}
        {runTest.error instanceof ApiError && runTest.error.status !== 400 && (
          <Alert color="red" icon={<IconPlugConnectedX size={18} />} title={runTest.error.title} />
        )}

        <Group justify="space-between">
          <Button
            variant="light"
            leftSection={<IconPlugConnected size={16} />}
            loading={runTest.isPending}
            onClick={() => {
              if (!form.validate().hasErrors) runTest.mutate(form.values);
            }}
          >
            Testar conexão
          </Button>
          <Group gap="sm">
            <Button variant="default" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={save.isPending}>
              {editing ? 'Salvar alterações' : 'Cadastrar servidor'}
            </Button>
          </Group>
        </Group>
      </Stack>
    </form>
  );
}
