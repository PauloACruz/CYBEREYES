import { ActionIcon, Badge, Button, Group, Modal, NumberInput, Paper, Select, Skeleton, Stack, Switch, Table, Text, Title, Tooltip } from '@mantine/core';
import { IconDeviceFloppy, IconPlus, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { clientsApi } from '../../api/clients';
import { queryKeys } from '../../api/queryKeys';
import { remoteApi } from '../../api/remote';
import type { ClientDto, RemoteConsentMode, RemotePolicyDto, RemotePolicyScope } from '../../api/types';
import { LoadError } from '../../components/TableStates';
import { notifySuccess } from '../../lib/feedback';

const POLICIES_KEY = ['remote-policies'] as const;

const CONSENT_OPTIONS: { value: RemoteConsentMode; label: string }[] = [
  { value: 'none', label: 'Não avisar' },
  { value: 'notify', label: 'Avisar o usuário durante o acesso' },
  { value: 'ask', label: 'Pedir permissão ao usuário' },
];

type BoolField = 'allowAtLoginScreen' | 'clipboardToRemote' | 'clipboardToLocal' | 'filesUpload' | 'filesDownload';
type NumberField = 'consentTimeoutSeconds' | 'maxFileMb' | 'idleMinutes' | 'maxHours';

const BOOL_FIELDS: { key: BoolField; label: string }[] = [
  { key: 'allowAtLoginScreen', label: 'Permitir na tela de login (sem usuário conectado)' },
  { key: 'clipboardToRemote', label: 'Área de transferência do técnico para a máquina' },
  { key: 'clipboardToLocal', label: 'Área de transferência da máquina para o técnico' },
  { key: 'filesUpload', label: 'Enviar arquivos para a máquina' },
  { key: 'filesDownload', label: 'Baixar arquivos da máquina' },
];

const NUMBER_FIELDS: { key: NumberField; label: string; min: number; max: number; suffix: string }[] = [
  { key: 'consentTimeoutSeconds', label: 'Prazo para o usuário responder', min: 10, max: 600, suffix: ' s' },
  { key: 'maxFileMb', label: 'Tamanho máximo por arquivo', min: 1, max: 102400, suffix: ' MB' },
  { key: 'idleMinutes', label: 'Encerrar sem uso após', min: 1, max: 1440, suffix: ' min' },
  { key: 'maxHours', label: 'Duração máxima da sessão', min: 1, max: 24, suffix: ' h' },
];

const EMPTY: RemotePolicyDto = {
  scope: 'client',
  scopeId: 0,
  consent: null,
  consentTimeoutSeconds: null,
  allowAtLoginScreen: null,
  clipboardToRemote: null,
  clipboardToLocal: null,
  filesUpload: null,
  filesDownload: null,
  maxFileMb: null,
  idleMinutes: null,
  maxHours: null,
  updatedAt: null,
  updatedBy: null,
};

/** Campos que a excecao muda (os demais herdam). */
function overriddenFields(p: RemotePolicyDto): string[] {
  const out: string[] = [];
  if (p.consent !== null) out.push(CONSENT_OPTIONS.find((o) => o.value === p.consent)?.label ?? p.consent);
  for (const f of BOOL_FIELDS) {
    const v = p[f.key];
    if (v !== null) out.push(`${f.label}: ${v ? 'sim' : 'não'}`);
  }
  for (const f of NUMBER_FIELDS) {
    const v = p[f.key];
    if (v !== null) out.push(`${f.label}: ${String(v)}${f.suffix}`);
  }
  return out;
}

function scopeName(p: RemotePolicyDto, clients: ClientDto[]): string {
  if (p.scope === 'client') return `Cliente ${clients.find((c) => c.id === p.scopeId)?.name ?? `#${String(p.scopeId)}`}`;
  for (const c of clients) {
    const site = c.sites.find((s) => s.id === p.scopeId);
    if (site) return `Site ${c.name} / ${site.name}`;
  }
  return `Site #${String(p.scopeId)}`;
}

/** Editor dos campos; com inherit, cada campo pode ficar "Herdar". */
function PolicyFields({ value, onChange, inherit }: { value: RemotePolicyDto; onChange: (next: RemotePolicyDto) => void; inherit: boolean }) {
  const triState = [
    { value: 'inherit', label: 'Herdar' },
    { value: 'true', label: 'Sim' },
    { value: 'false', label: 'Não' },
  ];
  return (
    <Stack gap="sm">
      <Select
        label="Aviso ao usuário da máquina"
        data={inherit ? [{ value: 'inherit', label: 'Herdar' }, ...CONSENT_OPTIONS] : CONSENT_OPTIONS}
        value={value.consent ?? (inherit ? 'inherit' : 'none')}
        onChange={(v) => onChange({ ...value, consent: v === null || v === 'inherit' ? null : (v) })}
        allowDeselect={false}
      />
      {BOOL_FIELDS.map((f) =>
        inherit ? (
          <Select
            key={f.key}
            label={f.label}
            data={triState}
            value={value[f.key] === null ? 'inherit' : String(value[f.key])}
            onChange={(v) => onChange({ ...value, [f.key]: v === 'true' ? true : v === 'false' ? false : null })}
            allowDeselect={false}
          />
        ) : (
          <Switch key={f.key} label={f.label} checked={value[f.key] === true} onChange={(e) => onChange({ ...value, [f.key]: e.currentTarget.checked })} />
        ),
      )}
      <Group grow align="flex-start">
        {NUMBER_FIELDS.map((f) => (
          <NumberInput
            key={f.key}
            label={f.label}
            suffix={f.suffix}
            min={f.min}
            max={f.max}
            allowDecimal={false}
            placeholder={inherit ? 'Herdar' : undefined}
            value={value[f.key] ?? ''}
            onChange={(v) => onChange({ ...value, [f.key]: typeof v === 'number' ? v : null })}
          />
        ))}
      </Group>
    </Stack>
  );
}

/** Politicas do acesso remoto (contrato, secao 8): global e excecoes por cliente ou site. */
export function RemotePoliciesSection() {
  const queryClient = useQueryClient();
  const policies = useQuery({ queryKey: POLICIES_KEY, queryFn: remoteApi.policies });
  const clients = useQuery({ queryKey: queryKeys.clients, queryFn: clientsApi.list });
  const [draft, setDraft] = useState<RemotePolicyDto | null>(null);
  const [override, setOverride] = useState<RemotePolicyDto | null>(null);
  const global = policies.data?.find((p) => p.scope === 'global');
  const form = draft ?? global ?? null;
  const overrides = (policies.data ?? []).filter((p) => p.scope !== 'global');

  const save = useMutation({
    mutationFn: (p: RemotePolicyDto) => remoteApi.savePolicy(p.scope, p.scopeId, p),
    onSuccess: () => {
      notifySuccess('Política de acesso remoto salva.');
      setDraft(null);
      setOverride(null);
      void queryClient.invalidateQueries({ queryKey: POLICIES_KEY });
    },
  });
  const remove = useMutation({
    mutationFn: (p: RemotePolicyDto) => remoteApi.deletePolicy(p.scope, p.scopeId),
    onSuccess: () => {
      notifySuccess('Exceção removida; o escopo volta a herdar.');
      void queryClient.invalidateQueries({ queryKey: POLICIES_KEY });
    },
  });

  const scopeOptions = (clients.data ?? []).flatMap((c) => [
    { value: `client:${String(c.id)}`, label: `Cliente ${c.name}` },
    ...c.sites.map((s) => ({ value: `site:${String(s.id)}`, label: `Site ${c.name} / ${s.name}` })),
  ]);

  return (
    <Paper withBorder p="lg" component="section" aria-labelledby="remote-policies-title">
      <Title order={3} id="remote-policies-title" size="h4" mb={4}>
        Acesso remoto
      </Title>
      <Text size="sm" c="dimmed" mb="md">
        Vale para todos os clientes, salvo as exceções abaixo. Por padrão o usuário da máquina não é avisado; ligue o aviso ou o pedido de permissão aqui.
      </Text>
      {policies.isError && <LoadError error={policies.error} onRetry={() => void policies.refetch()} />}
      {!form ? (
        <Skeleton height={240} />
      ) : (
        <>
          <PolicyFields value={form} onChange={setDraft} inherit={false} />
          <Group justify="flex-end" mt="md">
            <Button leftSection={<IconDeviceFloppy size={16} />} disabled={!draft} loading={save.isPending && !override} onClick={() => draft && save.mutate(draft)}>
              Salvar política global
            </Button>
          </Group>
        </>
      )}

      <Group justify="space-between" mt="xl" mb="xs">
        <Text fw={600}>Exceções por cliente ou site</Text>
        <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setOverride({ ...EMPTY })}>
          Adicionar exceção
        </Button>
      </Group>
      {overrides.length === 0 ? (
        <Text size="sm" c="dimmed">
          Nenhuma exceção: todos seguem a política global.
        </Text>
      ) : (
        <Table verticalSpacing="xs">
          <Table.Tbody>
            {overrides.map((p) => (
              <Table.Tr key={`${p.scope}:${String(p.scopeId)}`}>
                <Table.Td w={260}>
                  <Text size="sm" fw={500}>
                    {scopeName(p, clients.data ?? [])}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Group gap={4}>
                    {overriddenFields(p).map((f) => (
                      <Badge key={f} variant="light" size="sm" style={{ textTransform: 'none' }}>
                        {f}
                      </Badge>
                    ))}
                  </Group>
                </Table.Td>
                <Table.Td w={90}>
                  <Group gap={4} justify="flex-end">
                    <Button size="compact-xs" variant="subtle" onClick={() => setOverride(p)}>
                      Editar
                    </Button>
                    <Tooltip label="Remover exceção">
                      <ActionIcon variant="subtle" color="red" aria-label={`Remover exceção de ${scopeName(p, clients.data ?? [])}`} onClick={() => remove.mutate(p)}>
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Modal opened={override !== null} onClose={() => setOverride(null)} title="Exceção da política de acesso remoto" size="lg">
        {override && (
          <Stack>
            <Select
              label="Cliente ou site"
              searchable
              data={scopeOptions}
              value={override.scopeId ? `${override.scope}:${String(override.scopeId)}` : null}
              onChange={(v) => {
                if (!v) return;
                const [scope, id] = v.split(':');
                setOverride({ ...override, scope: scope as RemotePolicyScope, scopeId: Number(id) });
              }}
              placeholder="Escolha onde a exceção vale"
            />
            <PolicyFields value={override} onChange={setOverride} inherit />
            <Group justify="flex-end">
              <Button loading={save.isPending} disabled={!override.scopeId} onClick={() => save.mutate(override)}>
                Salvar exceção
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Paper>
  );
}
