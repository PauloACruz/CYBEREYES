import { useMemo } from 'react';
import {
  Alert,
  Autocomplete,
  Button,
  Checkbox,
  Divider,
  Group,
  Modal,
  NumberInput,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  TagsInput,
  Text,
  TextInput,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconInfoCircle } from '@tabler/icons-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { checksApi } from '../../../api/monitoring';
import { queryKeys } from '../../../api/queryKeys';
import { scriptsApi } from '../../../api/scripts';
import { PERMISSIONS, type CheckDto, type CheckType, type EventType, type SaveCheckRequest } from '../../../api/types';
import { hasPermission } from '../../../auth/permissions';
import { useMe } from '../../../auth/useMe';
import { StringListInput } from '../../../components/StringListInput';
import { notifySuccess } from '../../../lib/feedback';
import { applyServerErrors } from '../../../lib/forms';
import { supportsPlatform } from '../../scripts/scriptMeta';
import { isSeverity, SEVERITY_OPTIONS } from '../monitoringFormat';
import {
  buildCheckBody,
  changeCheckType,
  CHECK_TYPE_LABEL,
  checkToValues,
  checkTypeOptions,
  defaultCheckValues,
  EVENT_LOGS,
  EVENT_TYPE_LABEL,
  validateCheck,
  type CheckFormValues,
  type CheckOwner,
} from './checkForm';

interface CheckFormModalProps {
  opened: boolean;
  onClose: () => void;
  owner: CheckOwner;
  /** null cria um check novo. */
  current: CheckDto | null;
  /** Plataforma do agente; ausente em politicas (todos os tipos ficam disponiveis). */
  plat?: string;
  /** Sugestoes de disco (dispositivos do agente). */
  diskSuggestions?: string[];
  onSaved: () => void;
}

export function CheckFormModal({ opened, onClose, current, ...rest }: CheckFormModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} title={current ? 'Editar check' : 'Novo check'} size="xl" centered>
      {opened && <CheckForm key={current?.id ?? 'novo'} current={current} onClose={onClose} {...rest} />}
    </Modal>
  );
}

const CHECK_TYPES = Object.keys(CHECK_TYPE_LABEL) as CheckType[];
const isCheckType = (value: string | null): value is CheckType => value !== null && (CHECK_TYPES as string[]).includes(value);

export function CheckForm({
  current,
  owner,
  plat,
  diskSuggestions = [],
  onClose,
  onSaved,
}: Omit<CheckFormModalProps, 'opened'>) {
  const { data: me } = useMe();
  const canViewScripts = hasPermission(me, PERMISSIONS.scriptsView);
  const windowsAllowed = plat === undefined || plat === 'windows';
  const form = useForm<CheckFormValues>({
    initialValues: current ? checkToValues(current) : defaultCheckValues(),
    validate: (values) => validateCheck(values),
  });
  const type = form.values.checkType;

  const scripts = useQuery({ queryKey: queryKeys.scripts, queryFn: scriptsApi.list, enabled: canViewScripts && type === 'script' });
  const scriptOptions = useMemo(
    () =>
      (scripts.data ?? [])
        .filter((s) => plat === undefined || supportsPlatform(s, plat))
        .map((s) => ({ value: String(s.id), label: s.category ? `${s.category} / ${s.name}` : s.name })),
    [scripts.data, plat],
  );

  const save = useMutation({
    mutationFn: (body: SaveCheckRequest) => (current ? checksApi.update(current.id, body) : checksApi.create(body)),
    onSuccess: () => {
      notifySuccess(current ? 'Check atualizado.' : 'Check criado.');
      onSaved();
      onClose();
    },
    onError: (error) => applyServerErrors(form, error),
  });

  const selectType = (value: string | null) => {
    if (isCheckType(value)) form.setValues(changeCheckType(form.values, value));
  };

  const isDisk = type === 'diskspace';
  const isPercent = type === 'cpuload' || type === 'memory';

  return (
    <form onSubmit={form.onSubmit((values) => save.mutate(buildCheckBody(values, owner)))} noValidate>
      <Stack>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Select
            label="Tipo"
            required
            allowDeselect={false}
            data={checkTypeOptions(windowsAllowed)}
            value={type}
            onChange={selectType}
            disabled={current !== null}
            description={current ? 'O tipo não pode ser alterado depois de criado.' : undefined}
          />
          <TextInput label="Nome" placeholder="Opcional; gerado a partir do tipo" {...form.getInputProps('name')} />
        </SimpleGrid>

        {plat === undefined && (type === 'winsvc' || type === 'eventlog') && (
          <Alert color="blue" icon={<IconInfoCircle size={18} />}>
            Este tipo de check só é executado em agentes Windows.
          </Alert>
        )}

        {isDisk && (
          <Autocomplete
            label="Disco"
            required
            placeholder="C: ou /"
            data={diskSuggestions}
            {...form.getInputProps('disk')}
          />
        )}
        {(isDisk || isPercent) && (
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <NumberInput
              label={isDisk ? 'Aviso abaixo de (% livre)' : 'Aviso acima de (%)'}
              description="0 desliga este limite"
              min={0}
              max={99}
              allowDecimal={false}
              suffix="%"
              {...form.getInputProps('warningThreshold')}
            />
            <NumberInput
              label={isDisk ? 'Erro abaixo de (% livre)' : 'Erro acima de (%)'}
              description="0 desliga este limite"
              min={0}
              max={99}
              allowDecimal={false}
              suffix="%"
              {...form.getInputProps('errorThreshold')}
            />
          </SimpleGrid>
        )}
        {isPercent && (
          <Text size="xs" c="dimmed">
            O resultado considera a média das últimas 15 leituras.
          </Text>
        )}

        {type === 'ping' && <TextInput label="Endereço" required placeholder="8.8.8.8 ou servidor.local" {...form.getInputProps('ip')} />}

        {type === 'script' && (
          <>
            {canViewScripts ? (
              <Select
                label="Script da biblioteca"
                required
                searchable
                placeholder={scripts.isPending ? 'Carregando scripts...' : 'Escolha um script'}
                nothingFoundMessage="Nenhum script compatível"
                data={scriptOptions}
                {...form.getInputProps('scriptId')}
              />
            ) : (
              <Alert color="yellow" icon={<IconInfoCircle size={18} />}>
                Você precisa da permissão de ver scripts para escolher o script deste check.
              </Alert>
            )}
            <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
              <StringListInput
                label="Argumentos"
                addLabel="Adicionar argumento"
                placeholder="-Parametro valor"
                value={form.values.scriptArgs}
                onChange={(v) => form.setFieldValue('scriptArgs', v)}
              />
              <StringListInput
                label="Variáveis de ambiente"
                description="No formato NOME=valor"
                addLabel="Adicionar variável"
                placeholder="NOME=valor"
                value={form.values.envVars}
                onChange={(v) => form.setFieldValue('envVars', v)}
              />
            </SimpleGrid>
            <NumberInput label="Tempo limite (segundos)" min={1} max={86400} allowDecimal={false} w={220} {...form.getInputProps('timeout')} />
            <SimpleGrid cols={{ base: 1, md: 3 }}>
              <TagsInput
                label="Códigos de sucesso"
                description="Além do 0"
                placeholder="Digite e tecle Enter"
                {...form.getInputProps('successReturnCodes')}
              />
              <TagsInput label="Códigos de aviso" placeholder="Digite e tecle Enter" {...form.getInputProps('warningReturnCodes')} />
              <TagsInput label="Códigos de informação" placeholder="Digite e tecle Enter" {...form.getInputProps('infoReturnCodes')} />
            </SimpleGrid>
          </>
        )}

        {type === 'winsvc' && (
          <>
            <TextInput label="Nome do serviço" required description="Nome interno, por exemplo Spooler" {...form.getInputProps('svcName')} />
            <Group gap="xl">
              <Checkbox label="Aprovar se estiver iniciando" {...form.getInputProps('passIfStartPending', { type: 'checkbox' })} />
              <Checkbox label="Aprovar se o serviço não existir" {...form.getInputProps('passIfSvcNotExist', { type: 'checkbox' })} />
              <Checkbox label="Reiniciar se estiver parado" {...form.getInputProps('restartIfStopped', { type: 'checkbox' })} />
            </Group>
          </>
        )}

        {type === 'eventlog' && (
          <>
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <Select
                label="Log"
                allowDeselect={false}
                data={EVENT_LOGS.map((l) => ({ value: l, label: l }))}
                value={form.values.logName}
                onChange={(v) => v && form.setFieldValue('logName', v)}
              />
              <Select
                label="Tipo de evento"
                allowDeselect={false}
                data={(Object.keys(EVENT_TYPE_LABEL) as EventType[]).map((t) => ({ value: t, label: EVENT_TYPE_LABEL[t] }))}
                value={form.values.eventType}
                onChange={(v) => v && form.setFieldValue('eventType', v)}
              />
              <NumberInput
                label="ID do evento"
                min={0}
                allowDecimal={false}
                disabled={form.values.eventIdIsWildcard}
                {...form.getInputProps('eventId')}
              />
            </SimpleGrid>
            <Checkbox label="Qualquer ID de evento" {...form.getInputProps('eventIdIsWildcard', { type: 'checkbox' })} />
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <TextInput label="Origem contém" placeholder="Opcional" {...form.getInputProps('eventSource')} />
              <TextInput label="Mensagem contém" placeholder="Opcional" {...form.getInputProps('eventMessage')} />
            </SimpleGrid>
            <div>
              <Text size="sm" fw={500} mb={4}>
                Falhar quando
              </Text>
              <SegmentedControl
                data={[
                  { value: 'contains', label: 'Encontrar os eventos' },
                  { value: 'not_contains', label: 'Não encontrar os eventos' },
                ]}
                value={form.values.failWhen}
                onChange={(v) => form.setFieldValue('failWhen', v)}
              />
            </div>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <NumberInput label="Procurar nos últimos (dias)" min={1} max={365} allowDecimal={false} {...form.getInputProps('searchLastDays')} />
              <NumberInput label="Quantidade mínima de eventos" min={1} allowDecimal={false} {...form.getInputProps('numberOfEventsBeforeAlert')} />
            </SimpleGrid>
          </>
        )}

        <Divider label="Alertas" labelPosition="left" />
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <NumberInput label="Falhas antes de alertar" min={1} max={100} allowDecimal={false} {...form.getInputProps('failsBeforeAlert')} />
          <NumberInput
            label="Intervalo (segundos)"
            description="0 usa o intervalo do agente"
            min={0}
            max={86400}
            allowDecimal={false}
            {...form.getInputProps('runInterval')}
          />
          <Select
            label="Severidade do alerta"
            allowDeselect={false}
            data={SEVERITY_OPTIONS}
            value={form.values.alertSeverity}
            onChange={(v) => isSeverity(v) && form.setFieldValue('alertSeverity', v)}
            description={type === 'diskspace' || type === 'cpuload' || type === 'memory' || type === 'script' ? 'Os limites e códigos definem a severidade da falha' : undefined}
          />
        </SimpleGrid>
        <Group gap="xl">
          <Switch label="Alertar por e-mail" {...form.getInputProps('emailAlert', { type: 'checkbox' })} />
          <Switch label="Alertar por webhook" {...form.getInputProps('webhookAlert', { type: 'checkbox' })} />
          <Switch label="Mostrar no painel" {...form.getInputProps('dashboardAlert', { type: 'checkbox' })} />
        </Group>

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            {current ? 'Salvar' : 'Criar check'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
