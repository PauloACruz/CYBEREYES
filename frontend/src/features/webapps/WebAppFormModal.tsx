import { useState } from 'react';
import {
  Autocomplete,
  Button,
  Group,
  Menu,
  Modal,
  NumberInput,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Tabs,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconChevronDown, IconTemplate } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { ApiError } from '../../api/client';
import { queryKeys } from '../../api/queryKeys';
import type { SaveWebAppRequest, Severity, WebAppCheckType, WebAppDetail } from '../../api/types';
import { webAppsApi } from '../../api/webapps';
import { webAppPath } from '../../app/paths';
import { notifySuccess } from '../../lib/feedback';
import { applyServerErrors } from '../../lib/forms';
import { useClients } from '../clients/useClients';
import { optional } from '../inventory/inventoryFormat';
import { DEPLOY_TEMPLATES, ENVIRONMENT_OPTIONS, INTERVAL_OPTIONS, STACK_SUGGESTIONS } from './webappFormat';

interface WebAppFormModalProps {
  opened: boolean;
  onClose: () => void;
  app: WebAppDetail | null;
  defaultClientId?: number;
  defaultServerId?: number;
}

export function WebAppFormModal({ opened, onClose, app, defaultClientId, defaultServerId }: WebAppFormModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} title={app ? 'Editar aplicação' : 'Nova aplicação'} size="xl" centered>
      {opened && <WebAppForm onClose={onClose} app={app} defaultClientId={defaultClientId} defaultServerId={defaultServerId} />}
    </Modal>
  );
}

interface FormValues {
  clientId: string | null;
  serverId: string | null;
  name: string;
  environment: string;
  stack: string;
  url: string;
  notes: string;
  monitorEnabled: boolean;
  checkType: WebAppCheckType;
  checkTarget: string;
  method: 'GET' | 'HEAD';
  expectedStatus: string;
  keyword: string;
  intervalSeconds: string;
  timeoutSeconds: number | string;
  failuresBeforeAlert: number | string;
  alertSeverity: Severity;
  ignoreTlsErrors: boolean;
  sslWarnDays: number | string;
  deployPath: string;
  repoUrl: string;
  branch: string;
  deployScript: string;
  deployTimeoutMinutes: number | string;
}

type Tab = 'geral' | 'monitoramento' | 'deploy';

const FIELD_TAB: Record<string, Tab> = {
  checkTarget: 'monitoramento',
  checkType: 'monitoramento',
  method: 'monitoramento',
  expectedStatus: 'monitoramento',
  keyword: 'monitoramento',
  timeoutSeconds: 'monitoramento',
  failuresBeforeAlert: 'monitoramento',
  sslWarnDays: 'monitoramento',
  deployPath: 'deploy',
  repoUrl: 'deploy',
  branch: 'deploy',
  deployScript: 'deploy',
  deployTimeoutMinutes: 'deploy',
};

const isHttpUrl = (v: string) => /^https?:\/\/[^\s/]+\S*$/i.test(v.trim());

function WebAppForm({ onClose, app, defaultClientId, defaultServerId }: Omit<WebAppFormModalProps, 'opened'>) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const clients = useClients();
  const overview = useQuery({ queryKey: queryKeys.webAppOverview({}), queryFn: () => webAppsApi.overview() });
  const [tab, setTab] = useState<Tab>('geral');
  const editing = app !== null;
  const defaultServer = defaultServerId ? overview.data?.servers.find((s) => s.id === defaultServerId) : undefined;
  const form = useForm<FormValues>({
    initialValues: {
      clientId: app ? String(app.clientId) : defaultClientId ? String(defaultClientId) : defaultServer ? String(defaultServer.clientId) : null,
      serverId: app?.serverId ? String(app.serverId) : defaultServerId ? String(defaultServerId) : null,
      name: app?.name ?? '',
      environment: app?.environment ?? 'Produção',
      stack: app?.stack ?? '',
      url: app?.url ?? '',
      notes: app?.notes ?? '',
      monitorEnabled: app?.monitorEnabled ?? true,
      checkType: app?.checkType ?? 'http',
      checkTarget: app && app.checkTarget !== app.url ? app.checkTarget : '',
      method: app?.method ?? 'GET',
      expectedStatus: app?.expectedStatus ?? '200-399',
      keyword: app?.keyword ?? '',
      intervalSeconds: String(app?.intervalSeconds ?? 60),
      timeoutSeconds: app?.timeoutSeconds ?? 10,
      failuresBeforeAlert: app?.failuresBeforeAlert ?? 2,
      alertSeverity: app?.alertSeverity ?? 'error',
      ignoreTlsErrors: app?.ignoreTlsErrors ?? false,
      sslWarnDays: app?.sslWarnDays ?? 14,
      deployPath: app?.deployPath ?? '',
      repoUrl: app?.repoUrl ?? '',
      branch: app?.branch ?? 'main',
      deployScript: app?.deployScript ?? '',
      deployTimeoutMinutes: app?.deployTimeoutMinutes ?? 30,
    },
    validate: {
      clientId: (v) => (v ? null : 'Escolha o cliente'),
      name: (v) => (v.trim() ? null : 'Informe o nome'),
      url: (v) => (!v.trim() || isHttpUrl(v) ? null : 'Use um endereço iniciado por http:// ou https://'),
      checkTarget: (v, values) => {
        const target = v.trim();
        if (values.checkType === 'tcp') return /^[^\s:]+:\d{1,5}$/.test(target) ? null : 'Use host:porta, por exemplo 10.0.0.5:5432';
        if (!target) return values.url.trim() ? null : 'Informe a URL pública ou a URL a verificar';
        return isHttpUrl(target) ? null : 'Use um endereço iniciado por http:// ou https://';
      },
      expectedStatus: (v, values) => (values.checkType === 'tcp' || /^\s*\d{3}(\s*-\s*\d{3})?(\s*,\s*\d{3}(\s*-\s*\d{3})?)*\s*$/.test(v) ? null : 'Use 200-399 ou 200,301'),
      timeoutSeconds: (v, values) => (Number(v) >= 1 && Number(v) <= 60 && Number(v) < Number(values.intervalSeconds) ? null : 'Entre 1 e 60 s, menor que o intervalo'),
      failuresBeforeAlert: (v) => (Number(v) >= 1 && Number(v) <= 20 ? null : 'Entre 1 e 20'),
      sslWarnDays: (v) => (Number(v) >= 0 && Number(v) <= 365 ? null : 'Entre 0 e 365'),
      deployPath: (v) => (!v.trim() || /^(\/|~$|~\/)/.test(v.trim()) ? null : 'Use /caminho/absoluto ou ~/pasta'),
      deployScript: (v, values) => (v.trim() && !values.serverId ? 'Escolha o servidor na aba Geral para usar deploy' : null),
      deployTimeoutMinutes: (v) => (Number(v) >= 1 && Number(v) <= 240 ? null : 'Entre 1 e 240 minutos'),
    },
  });

  const servers = (overview.data?.servers ?? []).filter((s) => String(s.clientId) === form.values.clientId);

  const save = useMutation({
    mutationFn: (v: FormValues) => {
      const body: SaveWebAppRequest = {
        clientId: Number(v.clientId),
        serverId: v.serverId ? Number(v.serverId) : null,
        name: v.name.trim(),
        environment: optional(v.environment),
        stack: optional(v.stack),
        url: optional(v.url),
        notes: optional(v.notes),
        monitorEnabled: v.monitorEnabled,
        checkType: v.checkType,
        checkTarget: optional(v.checkTarget),
        method: v.method,
        expectedStatus: v.expectedStatus.trim() || '200-399',
        keyword: optional(v.keyword),
        intervalSeconds: Number(v.intervalSeconds),
        timeoutSeconds: Number(v.timeoutSeconds),
        failuresBeforeAlert: Number(v.failuresBeforeAlert),
        alertSeverity: v.alertSeverity,
        ignoreTlsErrors: v.ignoreTlsErrors,
        sslWarnDays: Number(v.sslWarnDays),
        deployPath: optional(v.deployPath),
        repoUrl: optional(v.repoUrl),
        branch: optional(v.branch),
        deployScript: v.deployScript.trim() ? v.deployScript : undefined,
        deployTimeoutMinutes: Number(v.deployTimeoutMinutes),
      };
      return app ? webAppsApi.update(app.id, body) : webAppsApi.create(body);
    },
    onSuccess: async (saved) => {
      notifySuccess(app ? 'Aplicação atualizada.' : 'Aplicação cadastrada. A primeira verificação sai em instantes.');
      void queryClient.invalidateQueries({ queryKey: queryKeys.webApps });
      onClose();
      if (!app) await navigate(webAppPath(saved.id));
    },
    onError: (error) => {
      applyServerErrors(form, error);
      const first = error instanceof ApiError ? Object.keys(error.fieldErrors)[0] : undefined;
      if (first) setTab(FIELD_TAB[first.charAt(0).toLowerCase() + first.slice(1)] ?? 'geral');
    },
  });

  const submit = form.onSubmit(
    (v) => save.mutate(v),
    (errors) => {
      const first = Object.keys(errors)[0];
      if (first) setTab(FIELD_TAB[first] ?? 'geral');
    },
  );

  const tcp = form.values.checkType === 'tcp';

  return (
    <form onSubmit={submit} noValidate autoComplete="off">
      <Tabs value={tab} onChange={(v) => setTab(v === 'monitoramento' || v === 'deploy' ? v : 'geral')} keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="geral">Geral</Tabs.Tab>
          <Tabs.Tab value="monitoramento">Monitoramento</Tabs.Tab>
          <Tabs.Tab value="deploy">Deploy</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="geral">
          <Stack>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <TextInput label="Nome" required data-autofocus maxLength={200} placeholder="Loja virtual" {...form.getInputProps('name')} />
              <Select
                label="Cliente"
                required
                searchable
                data={(clients.data ?? []).map((c) => ({ value: String(c.id), label: c.name }))}
                value={form.values.clientId}
                error={form.errors.clientId}
                onChange={(v) => {
                  form.setFieldValue('clientId', v);
                  form.setFieldValue('serverId', null);
                }}
              />
              <Select
                label="Servidor"
                description="Onde a aplicação roda. Sem servidor, só o monitoramento funciona."
                placeholder={form.values.clientId ? 'Hospedagem externa (sem SSH)' : 'Escolha o cliente primeiro'}
                clearable
                disabled={!form.values.clientId}
                data={servers.map((s) => ({ value: String(s.id), label: `${s.name} (${s.host})` }))}
                {...form.getInputProps('serverId')}
              />
              <TextInput label="URL pública" placeholder="https://loja.exemplo.com.br" {...form.getInputProps('url')} />
              <Autocomplete label="Ambiente" data={ENVIRONMENT_OPTIONS} maxLength={50} {...form.getInputProps('environment')} />
              <Autocomplete label="Tecnologia" placeholder="Docker Compose, Node.js..." data={STACK_SUGGESTIONS} maxLength={100} {...form.getInputProps('stack')} />
            </SimpleGrid>
            <Textarea label="Observações" autosize minRows={2} maxRows={6} {...form.getInputProps('notes')} />
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="monitoramento">
          <Stack>
            <Switch
              label="Monitorar disponibilidade"
              description="Verifica no intervalo escolhido e abre um alerta quando a aplicação sai do ar."
              {...form.getInputProps('monitorEnabled', { type: 'checkbox' })}
            />
            <SegmentedControl
              data={[
                { value: 'http', label: 'HTTP(S)' },
                { value: 'tcp', label: 'Porta TCP' },
              ]}
              value={form.values.checkType}
              onChange={(v) => form.setFieldValue('checkType', v === 'tcp' ? 'tcp' : 'http')}
              aria-label="Tipo de verificação"
              disabled={!form.values.monitorEnabled}
            />
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <TextInput
                label={tcp ? 'Host e porta' : 'URL verificada'}
                description={tcp ? 'Banco, fila ou outro serviço sem HTTP.' : 'Em branco usa a URL pública. Prefira uma rota de saúde, como /health.'}
                placeholder={tcp ? '10.0.0.5:5432' : form.values.url || 'https://loja.exemplo.com.br/health'}
                disabled={!form.values.monitorEnabled}
                {...form.getInputProps('checkTarget')}
              />
              <Select
                label="Intervalo"
                data={INTERVAL_OPTIONS}
                allowDeselect={false}
                disabled={!form.values.monitorEnabled}
                {...form.getInputProps('intervalSeconds')}
              />
              {!tcp && (
                <>
                  <Select
                    label="Método"
                    data={[
                      { value: 'GET', label: 'GET' },
                      { value: 'HEAD', label: 'HEAD (sem baixar a página)' },
                    ]}
                    allowDeselect={false}
                    disabled={!form.values.monitorEnabled}
                    value={form.values.method}
                    onChange={(v) => form.setFieldValue('method', v === 'HEAD' ? 'HEAD' : 'GET')}
                  />
                  <TextInput
                    label="Códigos aceitos"
                    description="Faixas e listas: 200-399, 200,301"
                    disabled={!form.values.monitorEnabled}
                    {...form.getInputProps('expectedStatus')}
                  />
                  <TextInput
                    label="Texto esperado na página"
                    description="Opcional. A página precisa conter este texto para contar como no ar."
                    disabled={!form.values.monitorEnabled || form.values.method === 'HEAD'}
                    maxLength={500}
                    {...form.getInputProps('keyword')}
                  />
                  <NumberInput
                    label="Avisar vencimento do certificado"
                    description="Dias antes do vencimento; 0 desliga o aviso."
                    min={0}
                    max={365}
                    allowDecimal={false}
                    suffix=" dias"
                    disabled={!form.values.monitorEnabled}
                    {...form.getInputProps('sslWarnDays')}
                  />
                </>
              )}
              <NumberInput
                label="Tempo limite"
                min={1}
                max={60}
                allowDecimal={false}
                suffix=" s"
                disabled={!form.values.monitorEnabled}
                {...form.getInputProps('timeoutSeconds')}
              />
              <NumberInput
                label="Falhas seguidas antes do alerta"
                description="Depois de uma falha a confirmação vem em até 20 s."
                min={1}
                max={20}
                allowDecimal={false}
                disabled={!form.values.monitorEnabled}
                {...form.getInputProps('failuresBeforeAlert')}
              />
              <Select
                label="Gravidade do alerta"
                data={[
                  { value: 'error', label: 'Erro' },
                  { value: 'warning', label: 'Aviso' },
                  { value: 'info', label: 'Informativo' },
                ]}
                allowDeselect={false}
                disabled={!form.values.monitorEnabled}
                value={form.values.alertSeverity}
                onChange={(v) => form.setFieldValue('alertSeverity', v === 'warning' || v === 'info' ? v : 'error')}
              />
            </SimpleGrid>
            {!tcp && (
              <Switch
                label="Aceitar certificado inválido ou autoassinado"
                description="Use só em ambientes internos; o aviso de vencimento continua."
                disabled={!form.values.monitorEnabled}
                {...form.getInputProps('ignoreTlsErrors', { type: 'checkbox' })}
              />
            )}
            <Text size="xs" c="dimmed">
              O alerta segue o template de alertas do cliente (ou o padrão): e-mail, webhook e chamado de incidente, conforme as configurações.
            </Text>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="deploy">
          <Stack>
            {!form.values.serverId && (
              <Text size="sm" c="dimmed">
                Escolha o servidor na aba Geral para configurar o deploy e os comandos por SSH.
              </Text>
            )}
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <TextInput
                label="Pasta no servidor"
                description="Deploy, comandos e terminal começam aqui."
                placeholder="/srv/loja"
                disabled={!form.values.serverId}
                {...form.getInputProps('deployPath')}
              />
              <TextInput
                label="Repositório"
                placeholder="git@github.com:empresa/loja.git"
                disabled={!form.values.serverId}
                {...form.getInputProps('repoUrl')}
              />
              <TextInput label="Branch" placeholder="main" disabled={!form.values.serverId} {...form.getInputProps('branch')} />
            </SimpleGrid>
            <Textarea
              label={
                <Group gap="xs" component="span">
                  <span>Script de deploy</span>
                  <Menu position="bottom-start" withinPortal>
                    <Menu.Target>
                      <Button size="compact-xs" variant="subtle" leftSection={<IconTemplate size={12} />} rightSection={<IconChevronDown size={12} />} disabled={!form.values.serverId}>
                        Modelos
                      </Button>
                    </Menu.Target>
                    <Menu.Dropdown>
                      {DEPLOY_TEMPLATES.map((t) => (
                        <Menu.Item key={t.label} onClick={() => form.setFieldValue('deployScript', t.script)}>
                          {t.label}
                        </Menu.Item>
                      ))}
                    </Menu.Dropdown>
                  </Menu>
                </Group>
              }
              description="Roda em bash na pasta da aplicação, com set -e: a primeira falha interrompe o deploy. Variáveis: $CYBEREYES_APP, $DEPLOY_PATH, $DEPLOY_REPO, $DEPLOY_BRANCH."
              placeholder={'git pull --ff-only\ndocker compose up -d --build'}
              autosize
              minRows={6}
              maxRows={16}
              spellCheck={false}
              styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)', fontSize: 13 } }}
              disabled={!form.values.serverId}
              {...form.getInputProps('deployScript')}
            />
            <NumberInput
              label="Tempo limite do deploy"
              min={1}
              max={240}
              allowDecimal={false}
              suffix=" min"
              w={220}
              disabled={!form.values.serverId}
              {...form.getInputProps('deployTimeoutMinutes')}
            />
          </Stack>
        </Tabs.Panel>
      </Tabs>

      <Group justify="flex-end" mt="lg">
        <Button variant="default" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" loading={save.isPending}>
          {editing ? 'Salvar alterações' : 'Cadastrar aplicação'}
        </Button>
      </Group>
    </form>
  );
}
