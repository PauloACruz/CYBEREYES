import { useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Divider,
  Group,
  NumberInput,
  Paper,
  PasswordInput,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconCircleCheck, IconCircleX, IconLock, IconMail, IconWebhook } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import { globalSettingsApi } from '../../api/settings';
import type { GlobalSettingsDto, SaveGlobalSettingsRequest, SuccessMessage } from '../../api/types';
import { LoadError } from '../../components/TableStates';
import { notifySuccess } from '../../lib/feedback';
import { applyServerErrors } from '../../lib/forms';

const DEFAULT_TIME_ZONE = 'America/Sao_Paulo';
const FALLBACK_ZONES = [
  'America/Sao_Paulo',
  'America/Manaus',
  'America/Cuiaba',
  'America/Belem',
  'America/Fortaleza',
  'America/Recife',
  'America/Bahia',
  'America/Porto_Velho',
  'America/Rio_Branco',
  'America/Noronha',
  'UTC',
];

function timeZones(): string[] {
  try {
    const list = Intl.supportedValuesOf('timeZone');
    return list.length ? list : FALLBACK_ZONES;
  } catch {
    return FALLBACK_ZONES;
  }
}

interface FormValues {
  smtpHost: string;
  smtpPort: number;
  smtpUsername: string;
  smtpPassword: string;
  clearPassword: boolean;
  smtpFrom: string;
  smtpUseTls: boolean;
  defaultWebhookUrl: string;
  timeZone: string;
  checkHistoryDays: number;
  agentHistoryDays: number;
}

function toValues(s: GlobalSettingsDto): FormValues {
  return {
    smtpHost: s.smtpHost ?? '',
    smtpPort: s.smtpPort,
    smtpUsername: s.smtpUsername ?? '',
    smtpPassword: '',
    clearPassword: false,
    smtpFrom: s.smtpFrom ?? '',
    smtpUseTls: s.smtpUseTls,
    defaultWebhookUrl: s.defaultWebhookUrl ?? '',
    timeZone: s.timeZone || DEFAULT_TIME_ZONE,
    checkHistoryDays: s.checkHistoryDays,
    agentHistoryDays: s.agentHistoryDays,
  };
}

const textOrNull = (v: string) => (v.trim() ? v.trim() : null);

/** Monta o PUT /api/settings: a senha so vai quando foi digitada (ou quando o usuario pede para remover). */
function buildSettingsBody(v: FormValues): SaveGlobalSettingsRequest {
  const body: SaveGlobalSettingsRequest = {
    smtpHost: textOrNull(v.smtpHost),
    smtpPort: v.smtpPort,
    smtpUsername: textOrNull(v.smtpUsername),
    smtpFrom: textOrNull(v.smtpFrom),
    smtpUseTls: v.smtpUseTls,
    defaultWebhookUrl: textOrNull(v.defaultWebhookUrl),
    timeZone: v.timeZone,
    checkHistoryDays: v.checkHistoryDays,
    agentHistoryDays: v.agentHistoryDays,
  };
  if (v.smtpPassword) body.smtpPassword = v.smtpPassword;
  else if (v.clearPassword) body.smtpPassword = '';
  return body;
}

export function NotificationsSection() {
  const settings = useQuery({ queryKey: queryKeys.globalSettings, queryFn: globalSettingsApi.get });
  return (
    <section aria-labelledby="notificacoes-title">
      <Title order={3} id="notificacoes-title">
        Notificações e geral
      </Title>
      <Text size="sm" c="dimmed" mb="xs">
        Servidor de e-mail, webhook padrão dos alertas, fuso horário das tarefas e retenção do histórico.
      </Text>
      {settings.isError && <LoadError error={settings.error} onRetry={() => void settings.refetch()} />}
      {settings.isPending && <Skeleton height={320} radius="md" />}
      {settings.data && <SettingsForm key={settings.dataUpdatedAt} settings={settings.data} />}
    </section>
  );
}

function TestResult({ result }: { result: SuccessMessage }) {
  return (
    <Alert
      color={result.success ? 'teal' : 'red'}
      icon={result.success ? <IconCircleCheck size={18} /> : <IconCircleX size={18} />}
      title={result.success ? 'Teste enviado' : 'O teste falhou'}
      role="status"
    >
      {result.message}
    </Alert>
  );
}

function SettingsForm({ settings }: { settings: GlobalSettingsDto }) {
  const queryClient = useQueryClient();
  const zones = useMemo(() => timeZones().map((z) => ({ value: z, label: z.replace(/_/g, ' ') })), []);
  const form = useForm<FormValues>({
    initialValues: toValues(settings),
    validate: {
      smtpPort: (v) => (Number.isInteger(v) && v >= 1 && v <= 65535 ? null : 'Entre 1 e 65535'),
      smtpFrom: (v) => (!v.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? null : 'E-mail inválido'),
      defaultWebhookUrl: (v) => (!v.trim() || /^https?:\/\/\S+$/i.test(v.trim()) ? null : 'Use uma URL http ou https'),
      timeZone: (v) => (v ? null : 'Escolha o fuso horário'),
      checkHistoryDays: (v) => (Number.isInteger(v) && v >= 1 && v <= 3650 ? null : 'Entre 1 e 3650 dias'),
      agentHistoryDays: (v) => (Number.isInteger(v) && v >= 1 && v <= 3650 ? null : 'Entre 1 e 3650 dias'),
    },
  });
  const save = useMutation({
    mutationFn: (body: SaveGlobalSettingsRequest) => globalSettingsApi.save(body),
    onSuccess: (data) => {
      notifySuccess('Configurações salvas.');
      queryClient.setQueryData(queryKeys.globalSettings, data);
    },
    onError: (error) => applyServerErrors(form, error),
  });

  const [testTo, setTestTo] = useState('');
  const testEmail = useMutation({ mutationFn: (to: string) => globalSettingsApi.testEmail(to) });
  const testWebhook = useMutation({ mutationFn: (url: string) => globalSettingsApi.testWebhook(url) });
  const webhookUrl = form.values.defaultWebhookUrl.trim();
  const toValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testTo.trim());

  return (
    <Paper withBorder p="lg">
      <form onSubmit={form.onSubmit((v) => save.mutate(buildSettingsBody(v)))} noValidate>
        <Stack>
          <Group gap="xs">
            <IconMail size={18} aria-hidden />
            <Text fw={600}>E-mail (SMTP)</Text>
          </Group>
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <TextInput label="Servidor SMTP" placeholder="smtp.empresa.com.br" {...form.getInputProps('smtpHost')} />
            <NumberInput label="Porta" min={1} max={65535} allowDecimal={false} {...form.getInputProps('smtpPort')} />
            <TextInput label="Remetente" placeholder="alertas@empresa.com.br" {...form.getInputProps('smtpFrom')} />
            <TextInput label="Usuário" autoComplete="off" {...form.getInputProps('smtpUsername')} />
            <PasswordInput
              label={
                <Group gap={6} component="span">
                  Senha
                  {settings.smtpPasswordSet && (
                    <Badge size="xs" variant="light" color="teal" leftSection={<IconLock size={10} aria-hidden />}>
                      Cadastrada
                    </Badge>
                  )}
                </Group>
              }
              placeholder={settings.smtpPasswordSet ? 'Deixe em branco para manter' : 'Sem senha cadastrada'}
              autoComplete="new-password"
              disabled={form.values.clearPassword}
              {...form.getInputProps('smtpPassword')}
            />
            <Stack gap={8} justify="flex-end" pb={4}>
              <Switch label="Usar TLS" {...form.getInputProps('smtpUseTls', { type: 'checkbox' })} />
              {settings.smtpPasswordSet && <Checkbox label="Remover a senha salva" {...form.getInputProps('clearPassword', { type: 'checkbox' })} />}
            </Stack>
          </SimpleGrid>

          <Divider />
          <Group gap="xs">
            <IconWebhook size={18} aria-hidden />
            <Text fw={600}>Webhook padrão</Text>
          </Group>
          <TextInput
            label="URL do webhook padrão"
            description="Usado pelos templates de alerta que não definem uma URL própria"
            placeholder="https://..."
            {...form.getInputProps('defaultWebhookUrl')}
          />

          <Divider />
          <Text fw={600}>Geral</Text>
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <Select
              label="Fuso horário"
              description="Usado nos horários das tarefas"
              searchable
              allowDeselect={false}
              data={zones}
              {...form.getInputProps('timeZone')}
            />
            <NumberInput label="Dias de histórico de checks" min={1} max={3650} allowDecimal={false} {...form.getInputProps('checkHistoryDays')} />
            <NumberInput label="Dias de histórico do agente" min={1} max={3650} allowDecimal={false} {...form.getInputProps('agentHistoryDays')} />
          </SimpleGrid>
          <Group justify="flex-end">
            <Button type="submit" loading={save.isPending}>
              Salvar configurações
            </Button>
          </Group>
        </Stack>
      </form>

      <Divider my="lg" label="Testes" labelPosition="left" />
      <Text size="sm" c="dimmed" mb="sm">
        O teste de e-mail usa as configurações salvas; salve antes de testar.
      </Text>
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        <Stack gap="xs">
          <Group align="flex-end" wrap="nowrap">
            <TextInput
              label="Enviar e-mail de teste para"
              placeholder="voce@empresa.com.br"
              value={testTo}
              onChange={(e) => setTestTo(e.currentTarget.value)}
              flex={1}
            />
            <Button variant="light" loading={testEmail.isPending} disabled={!toValid} onClick={() => testEmail.mutate(testTo.trim())}>
              Testar e-mail
            </Button>
          </Group>
          {testEmail.data && <TestResult result={testEmail.data} />}
        </Stack>
        <Stack gap="xs">
          <Group align="flex-end" wrap="nowrap">
            <TextInput label="Webhook a testar" value={webhookUrl || 'Informe a URL do webhook padrão'} readOnly flex={1} />
            <Button variant="light" loading={testWebhook.isPending} disabled={!webhookUrl} onClick={() => testWebhook.mutate(webhookUrl)}>
              Testar webhook
            </Button>
          </Group>
          {testWebhook.data && <TestResult result={testWebhook.data} />}
        </Stack>
      </SimpleGrid>
    </Paper>
  );
}
