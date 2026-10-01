import { Button, Group, Modal, NumberInput, Select, SimpleGrid, Stack, Textarea, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { networksApi } from '../../../api/docs';
import { queryKeys } from '../../../api/queryKeys';
import type { NetworkDto, SaveNetworkRequest } from '../../../api/types';
import { notifySuccess } from '../../../lib/feedback';
import { applyServerErrors } from '../../../lib/forms';
import { cidrContains, isValidCidr, isValidIp, normalizeCidr } from '../../../lib/network';
import { useClients } from '../../clients/useClients';
import { optional } from '../../inventory/inventoryFormat';

interface NetworkFormModalProps {
  opened: boolean;
  onClose: () => void;
  network?: NetworkDto;
  /** Cliente pre-selecionado (filtro atual da lista). */
  defaultClientId?: number;
}

export function NetworkFormModal({ opened, onClose, network, defaultClientId }: NetworkFormModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} title={network ? 'Editar rede' : 'Nova rede'} size="lg" centered>
      {opened && <NetworkForm onClose={onClose} network={network} defaultClientId={defaultClientId} />}
    </Modal>
  );
}

interface FormValues {
  clientId: string | null;
  siteId: string | null;
  name: string;
  cidr: string;
  vlanId: number | string;
  vlanName: string;
  gateway: string;
  dnsServers: string;
  dhcpRange: string;
  description: string;
}

function NetworkForm({ onClose, network, defaultClientId }: { onClose: () => void; network?: NetworkDto; defaultClientId?: number }) {
  const queryClient = useQueryClient();
  const clients = useClients();
  const form = useForm<FormValues>({
    initialValues: {
      clientId: network ? String(network.clientId) : defaultClientId ? String(defaultClientId) : null,
      siteId: network?.siteId ? String(network.siteId) : null,
      name: network?.name ?? '',
      cidr: network?.cidr ?? '',
      vlanId: network?.vlanId ?? '',
      vlanName: network?.vlanName ?? '',
      gateway: network?.gateway ?? '',
      dnsServers: network?.dnsServers ?? '',
      dhcpRange: network?.dhcpRange ?? '',
      description: network?.description ?? '',
    },
    validate: {
      clientId: (v) => (v ? null : 'Escolha o cliente'),
      name: (v) => {
        const len = v.trim().length;
        if (len < 1) return 'Informe o nome';
        return len > 200 ? 'Use no máximo 200 caracteres' : null;
      },
      cidr: (v) => {
        if (!v.trim()) return 'Informe a faixa no formato CIDR';
        return isValidCidr(v) ? null : 'CIDR inválido. Use, por exemplo, 192.168.1.0/24';
      },
      vlanId: (v) => {
        if (v === '') return null;
        const n = Number(v);
        return Number.isInteger(n) && n >= 1 && n <= 4094 ? null : 'A VLAN vai de 1 a 4094';
      },
      gateway: (v, values) => {
        if (!v.trim()) return null;
        if (!isValidIp(v)) return 'IP inválido';
        return isValidCidr(values.cidr) && !cidrContains(values.cidr, v.trim()) ? 'O gateway precisa estar dentro da rede' : null;
      },
    },
  });

  const save = useMutation({
    mutationFn: (body: SaveNetworkRequest) => (network ? networksApi.update(network.id, body) : networksApi.create(body)),
    onSuccess: () => {
      notifySuccess(network ? 'Rede atualizada.' : 'Rede cadastrada.');
      void queryClient.invalidateQueries({ queryKey: queryKeys.networks });
      void queryClient.invalidateQueries({ queryKey: queryKeys.assets });
      onClose();
    },
    onError: (error) => applyServerErrors(form, error),
  });

  const submit = (v: FormValues) =>
    save.mutate({
      clientId: Number(v.clientId),
      siteId: v.siteId ? Number(v.siteId) : undefined,
      name: v.name.trim(),
      cidr: v.cidr.trim(),
      vlanId: v.vlanId === '' ? undefined : Number(v.vlanId),
      vlanName: optional(v.vlanName),
      gateway: optional(v.gateway),
      dnsServers: optional(v.dnsServers),
      dhcpRange: optional(v.dhcpRange),
      description: optional(v.description),
    });

  const selectedClient = clients.data?.find((c) => String(c.id) === form.values.clientId);
  const normalized = isValidCidr(form.values.cidr) ? normalizeCidr(form.values.cidr) : null;
  const cidrHint = normalized && normalized !== form.values.cidr.trim() ? `Será gravada como ${normalized}` : 'IPv4 ou IPv6, por exemplo 192.168.1.0/24';

  return (
    <form onSubmit={form.onSubmit(submit)} noValidate>
      <Stack>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label="Nome" required data-autofocus maxLength={200} placeholder="Rede administrativa" {...form.getInputProps('name')} />
          <TextInput label="Faixa (CIDR)" required ff="monospace" description={cidrHint} {...form.getInputProps('cidr')} />
          <Select
            label="Cliente"
            required
            searchable
            data={(clients.data ?? []).map((c) => ({ value: String(c.id), label: c.name }))}
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
            data={(selectedClient?.sites ?? []).map((s) => ({ value: String(s.id), label: s.name }))}
            {...form.getInputProps('siteId')}
          />
          <NumberInput label="VLAN" min={1} max={4094} allowDecimal={false} allowNegative={false} {...form.getInputProps('vlanId')} />
          <TextInput label="Nome da VLAN" maxLength={200} {...form.getInputProps('vlanName')} />
          <TextInput label="Gateway" ff="monospace" placeholder="192.168.1.1" {...form.getInputProps('gateway')} />
          <TextInput label="Servidores DNS" ff="monospace" placeholder="192.168.1.1, 8.8.8.8" {...form.getInputProps('dnsServers')} />
          <TextInput label="Faixa de DHCP" ff="monospace" placeholder="192.168.1.100 a 192.168.1.200" {...form.getInputProps('dhcpRange')} />
        </SimpleGrid>
        <Textarea label="Descrição" autosize minRows={2} maxRows={6} {...form.getInputProps('description')} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            {network ? 'Salvar alterações' : 'Cadastrar rede'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
