import { Button, Group, Modal, Select, SimpleGrid, Stack, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { networksApi } from '../../../api/docs';
import { queryKeys } from '../../../api/queryKeys';
import type { IpKind, IpRecordDto, NetworkDetail, SaveIpRecordRequest } from '../../../api/types';
import { notifySuccess } from '../../../lib/feedback';
import { applyServerErrors } from '../../../lib/forms';
import { cidrContains, isValidIp, isValidMac, normalizeMac } from '../../../lib/network';
import { AssetSearchSelect } from '../../inventory/AssetSearchSelect';
import { IP_KIND_OPTIONS, isIpKind, optional } from '../../inventory/inventoryFormat';

export interface IpPrefill {
  address: string;
  assetId: number | null;
  assetName: string | null;
}

interface IpRecordFormModalProps {
  opened: boolean;
  onClose: () => void;
  network: NetworkDetail;
  record?: IpRecordDto;
  prefill?: IpPrefill;
}

export function IpRecordFormModal({ opened, onClose, network, record, prefill }: IpRecordFormModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} title={record ? `Editar ${record.address}` : 'Adicionar IP'} size="lg" centered>
      {opened && <IpRecordForm onClose={onClose} network={network} record={record} prefill={prefill} />}
    </Modal>
  );
}

interface FormValues {
  address: string;
  assetId: string | null;
  hostname: string;
  macAddress: string;
  kind: IpKind;
  description: string;
}

function IpRecordForm({ onClose, network, record, prefill }: Omit<IpRecordFormModalProps, 'opened'>) {
  const queryClient = useQueryClient();
  const initialAssetId = record?.assetId ?? prefill?.assetId ?? null;
  const form = useForm<FormValues>({
    initialValues: {
      address: record?.address ?? prefill?.address ?? '',
      assetId: initialAssetId ? String(initialAssetId) : null,
      hostname: record?.hostname ?? '',
      macAddress: record?.macAddress ?? '',
      kind: record?.kind ?? 'static',
      description: record?.description ?? '',
    },
    validate: {
      address: (v) => {
        if (!v.trim()) return 'Informe o endereço';
        if (!isValidIp(v)) return 'IP inválido';
        return cidrContains(network.cidr, v.trim()) ? null : `O endereço precisa estar dentro de ${network.cidr}`;
      },
      macAddress: (v) => (!v.trim() || isValidMac(v) ? null : 'Use o formato AA:BB:CC:DD:EE:FF'),
    },
  });

  const save = useMutation({
    mutationFn: (body: SaveIpRecordRequest) => (record ? networksApi.updateIp(network.id, record.id, body) : networksApi.addIp(network.id, body)),
    onSuccess: () => {
      notifySuccess(record ? 'Registro de IP atualizado.' : 'IP registrado.');
      void queryClient.invalidateQueries({ queryKey: queryKeys.networks });
      void queryClient.invalidateQueries({ queryKey: queryKeys.assetSheets });
      onClose();
    },
    onError: (error) => applyServerErrors(form, error),
  });

  const submit = (v: FormValues) => {
    const mac = optional(v.macAddress);
    save.mutate({
      address: v.address.trim(),
      assetId: v.assetId ? Number(v.assetId) : undefined,
      hostname: optional(v.hostname),
      macAddress: mac ? normalizeMac(mac) : undefined,
      kind: v.kind,
      description: optional(v.description),
    });
  };

  return (
    <form onSubmit={form.onSubmit(submit)} noValidate>
      <Stack>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label="Endereço" required ff="monospace" description={`Dentro de ${network.cidr}`} data-autofocus {...form.getInputProps('address')} />
          <Select
            label="Tipo"
            data={IP_KIND_OPTIONS}
            allowDeselect={false}
            value={form.values.kind}
            onChange={(v) => {
              if (isIpKind(v)) form.setFieldValue('kind', v);
            }}
          />
          <TextInput label="Hostname" maxLength={200} {...form.getInputProps('hostname')} />
          <TextInput label="Endereço MAC" ff="monospace" placeholder="AA:BB:CC:DD:EE:FF" {...form.getInputProps('macAddress')} />
        </SimpleGrid>
        <AssetSearchSelect
          label="Ativo"
          description="Opcional"
          clientId={network.clientId}
          value={form.values.assetId}
          currentLabel={record?.assetName ?? prefill?.assetName}
          onChange={(value, asset) => {
            form.setFieldValue('assetId', value);
            if (asset && !form.values.hostname.trim()) form.setFieldValue('hostname', asset.name);
          }}
        />
        <TextInput label="Descrição" maxLength={500} {...form.getInputProps('description')} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            {record ? 'Salvar alterações' : 'Registrar IP'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
