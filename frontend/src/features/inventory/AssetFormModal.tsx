import { Button, Group, Modal, Select, SimpleGrid, Stack, Textarea, TextInput } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router';
import { assetsApi } from '../../api/inventory';
import { queryKeys } from '../../api/queryKeys';
import type { AssetDetail, AssetSheet, AssetStatus, AssetType, SaveAssetRequest } from '../../api/types';
import { assetPath } from '../../app/paths';
import { notifySuccess } from '../../lib/feedback';
import { applyServerErrors } from '../../lib/forms';
import { isValidIp, isValidMac, normalizeMac } from '../../lib/network';
import { useClients } from '../clients/useClients';
import { ASSET_STATUS_OPTIONS, ASSET_TYPE_INFO, ASSET_TYPE_OPTIONS, isAssetStatus, isAssetType, optional } from './inventoryFormat';

interface AssetFormModalProps {
  opened: boolean;
  onClose: () => void;
  /** Ativo em edicao; ausente cria um novo. */
  asset?: AssetDetail;
}

export function AssetFormModal({ opened, onClose, asset }: AssetFormModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} title={asset ? 'Editar ativo' : 'Novo ativo'} size="xl" centered>
      {opened && <AssetForm onClose={onClose} asset={asset} />}
    </Modal>
  );
}

interface AssetFormValues {
  clientId: string | null;
  siteId: string | null;
  type: AssetType;
  name: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  assetTag: string;
  status: AssetStatus;
  purchaseDate: string | null;
  warrantyUntil: string | null;
  location: string;
  ipAddress: string;
  macAddress: string;
  notes: string;
}

function initialValues(asset: AssetDetail | undefined): AssetFormValues {
  return {
    clientId: asset ? String(asset.clientId) : null,
    siteId: asset?.siteId ? String(asset.siteId) : null,
    type: asset?.type ?? 'workstation',
    name: asset?.name ?? '',
    manufacturer: asset?.manufacturer ?? '',
    model: asset?.model ?? '',
    serialNumber: asset?.serialNumber ?? '',
    assetTag: asset?.assetTag ?? '',
    status: asset?.status ?? 'active',
    purchaseDate: asset?.purchaseDate ?? null,
    warrantyUntil: asset?.warrantyUntil ?? null,
    location: asset?.location ?? '',
    ipAddress: asset?.ipAddress ?? '',
    macAddress: asset?.macAddress ?? '',
    notes: asset?.notes ?? '',
  };
}

/** Datas do DateInput chegam como AAAA-MM-DD; corta qualquer hora que venha junto. */
function dateOnly(value: string | null): string | undefined {
  return value ? value.slice(0, 10) : undefined;
}

function buildAssetBody(v: AssetFormValues): SaveAssetRequest {
  const mac = optional(v.macAddress);
  return {
    clientId: Number(v.clientId),
    siteId: v.siteId ? Number(v.siteId) : undefined,
    type: v.type,
    name: v.name.trim(),
    manufacturer: optional(v.manufacturer),
    model: optional(v.model),
    serialNumber: optional(v.serialNumber),
    assetTag: optional(v.assetTag),
    status: v.status,
    purchaseDate: dateOnly(v.purchaseDate),
    warrantyUntil: dateOnly(v.warrantyUntil),
    location: optional(v.location),
    ipAddress: optional(v.ipAddress),
    macAddress: mac ? normalizeMac(mac) : undefined,
    notes: optional(v.notes),
  };
}

const assetValidators = {
  clientId: (v: string | null) => (v ? null : 'Escolha o cliente'),
  name: (v: string) => {
    const len = v.trim().length;
    if (len < 1) return 'Informe o nome';
    return len > 200 ? 'Use no máximo 200 caracteres' : null;
  },
  ipAddress: (v: string) => (!v.trim() || isValidIp(v) ? null : 'IP inválido'),
  macAddress: (v: string) => (!v.trim() || isValidMac(v) ? null : 'Use o formato AA:BB:CC:DD:EE:FF'),
  purchaseDate: (v: string | null) => (v && dayjs(v).isAfter(dayjs(), 'day') ? 'A data de compra não pode ser futura' : null),
  warrantyUntil: (v: string | null, values: AssetFormValues) =>
    v && values.purchaseDate && dayjs(v).isBefore(dayjs(values.purchaseDate), 'day') ? 'A garantia não pode terminar antes da compra' : null,
  notes: (v: string) => (v.length > 5000 ? 'Use no máximo 5000 caracteres' : null),
};

function AssetForm({ onClose, asset }: { onClose: () => void; asset?: AssetDetail }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const clients = useClients();
  const fromAgent = asset?.agentId !== null && asset?.agentId !== undefined;

  const form = useForm<AssetFormValues>({ initialValues: initialValues(asset), validate: assetValidators });

  const save = useMutation({
    mutationFn: (body: SaveAssetRequest) => (asset ? assetsApi.update(asset.id, body) : assetsApi.create(body)),
    onSuccess: async (sheet: AssetSheet) => {
      notifySuccess(asset ? 'Ativo atualizado.' : `Ativo ${sheet.asset.name} cadastrado.`);
      queryClient.setQueryData(queryKeys.assetSheet(sheet.asset.id), sheet);
      void queryClient.invalidateQueries({ queryKey: queryKeys.assetLists });
      void queryClient.invalidateQueries({ queryKey: queryKeys.people });
      onClose();
      if (!asset) await navigate(assetPath(sheet.asset.id));
    },
    onError: (error) => applyServerErrors(form, error),
  });

  const clientOptions = (clients.data ?? []).map((c) => ({ value: String(c.id), label: c.name }));
  const selectedClient = clients.data?.find((c) => String(c.id) === form.values.clientId);
  const siteOptions = (selectedClient?.sites ?? []).map((s) => ({ value: String(s.id), label: s.name }));
  // Em ativo de agente o servidor ignora o tipo, exceto a troca para Notebook.
  const typeOptions =
    asset && fromAgent
      ? [...new Set<AssetType>([asset.type, 'laptop'])].map((value) => ({ value, label: ASSET_TYPE_INFO[value].label }))
      : ASSET_TYPE_OPTIONS;

  return (
    <form onSubmit={form.onSubmit((values) => save.mutate(buildAssetBody(values)))} noValidate>
      <Stack>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput
            label="Nome"
            required
            data-autofocus
            maxLength={200}
            disabled={fromAgent}
            description={fromAgent ? 'Definido pelo hostname do agente.' : undefined}
            {...form.getInputProps('name')}
          />
          <Select
            label="Tipo"
            data={typeOptions}
            allowDeselect={false}
            description={fromAgent ? 'Em máquina monitorada, só é possível marcar como Notebook.' : undefined}
            value={form.values.type}
            onChange={(v) => {
              if (isAssetType(v)) form.setFieldValue('type', v);
            }}
          />
          <Select
            label="Cliente"
            required
            searchable
            data={clientOptions}
            value={form.values.clientId}
            error={form.errors.clientId}
            onChange={(v) => {
              form.setFieldValue('clientId', v);
              form.setFieldValue('siteId', null);
            }}
          />
          <Select
            label="Site"
            placeholder={selectedClient ? 'Sem site' : 'Escolha o cliente primeiro'}
            clearable
            disabled={!selectedClient}
            data={siteOptions}
            {...form.getInputProps('siteId')}
          />
          <Select
            label="Status"
            data={ASSET_STATUS_OPTIONS}
            allowDeselect={false}
            value={form.values.status}
            onChange={(v) => {
              if (isAssetStatus(v)) form.setFieldValue('status', v);
            }}
          />
          <TextInput label="Patrimônio" maxLength={100} {...form.getInputProps('assetTag')} />
          <TextInput label="Fabricante" maxLength={200} {...form.getInputProps('manufacturer')} />
          <TextInput label="Modelo" maxLength={200} {...form.getInputProps('model')} />
          <TextInput label="Número de série" maxLength={200} {...form.getInputProps('serialNumber')} />
          <TextInput label="Localização" placeholder="Sala, andar, rack" maxLength={200} {...form.getInputProps('location')} />
          <TextInput label="Endereço IP" placeholder="192.168.0.10" ff="monospace" {...form.getInputProps('ipAddress')} />
          <TextInput label="Endereço MAC" placeholder="AA:BB:CC:DD:EE:FF" ff="monospace" {...form.getInputProps('macAddress')} />
          <DateInput
            label="Data de compra"
            valueFormat="DD/MM/YYYY"
            clearable
            maxDate={dayjs().format('YYYY-MM-DD')}
            {...form.getInputProps('purchaseDate')}
          />
          <DateInput label="Garantia até" valueFormat="DD/MM/YYYY" clearable {...form.getInputProps('warrantyUntil')} />
        </SimpleGrid>
        <Textarea label="Observações" autosize minRows={3} maxRows={8} {...form.getInputProps('notes')} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            {asset ? 'Salvar alterações' : 'Cadastrar ativo'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
