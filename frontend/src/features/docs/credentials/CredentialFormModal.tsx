import { Button, Group, Modal, PasswordInput, Select, SimpleGrid, Stack, Textarea, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { credentialsApi } from '../../../api/docs';
import { queryKeys } from '../../../api/queryKeys';
import type { CredentialDto, SaveCredentialRequest } from '../../../api/types';
import { notifySuccess } from '../../../lib/feedback';
import { applyServerErrors } from '../../../lib/forms';
import { useClients } from '../../clients/useClients';
import { AssetSearchSelect } from '../../inventory/AssetSearchSelect';
import { optional } from '../../inventory/inventoryFormat';

interface CredentialFormModalProps {
  opened: boolean;
  onClose: () => void;
  credential?: CredentialDto;
  defaultClientId?: number;
}

export function CredentialFormModal({ opened, onClose, credential, defaultClientId }: CredentialFormModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} title={credential ? 'Editar credencial' : 'Nova credencial'} size="lg" centered>
      {opened && <CredentialForm onClose={onClose} credential={credential} defaultClientId={defaultClientId} />}
    </Modal>
  );
}

interface FormValues {
  clientId: string | null;
  siteId: string | null;
  assetId: string | null;
  name: string;
  username: string;
  secret: string;
  url: string;
  notes: string;
}

function CredentialForm({ onClose, credential, defaultClientId }: Omit<CredentialFormModalProps, 'opened'>) {
  const queryClient = useQueryClient();
  const clients = useClients();
  const editing = credential !== undefined;
  const form = useForm<FormValues>({
    initialValues: {
      clientId: credential ? String(credential.clientId) : defaultClientId ? String(defaultClientId) : null,
      siteId: credential?.siteId ? String(credential.siteId) : null,
      assetId: credential?.assetId ? String(credential.assetId) : null,
      name: credential?.name ?? '',
      username: credential?.username ?? '',
      secret: '',
      url: credential?.url ?? '',
      notes: credential?.notes ?? '',
    },
    validate: {
      clientId: (v) => (v ? null : 'Escolha o cliente'),
      name: (v) => {
        const len = v.trim().length;
        if (len < 1) return 'Informe o nome';
        return len > 200 ? 'Use no máximo 200 caracteres' : null;
      },
      secret: (v) => (!editing && !v ? 'Informe a senha ou o segredo' : null),
      url: (v) => (!v.trim() || /^https?:\/\/\S+$/i.test(v.trim()) ? null : 'Use um endereço iniciado por http:// ou https://'),
    },
  });

  const save = useMutation({
    mutationFn: (body: SaveCredentialRequest) => (credential ? credentialsApi.update(credential.id, body) : credentialsApi.create(body)),
    onSuccess: () => {
      notifySuccess(credential ? 'Credencial atualizada.' : 'Credencial cadastrada.');
      void queryClient.invalidateQueries({ queryKey: queryKeys.credentials });
      void queryClient.invalidateQueries({ queryKey: queryKeys.assetSheets });
      onClose();
    },
    onError: (error) => applyServerErrors(form, error),
  });

  const submit = (v: FormValues) =>
    save.mutate({
      clientId: Number(v.clientId),
      siteId: v.siteId ? Number(v.siteId) : undefined,
      assetId: v.assetId ? Number(v.assetId) : undefined,
      name: v.name.trim(),
      username: optional(v.username),
      // No PUT, segredo ausente mantem o atual.
      secret: v.secret ? v.secret : undefined,
      url: optional(v.url),
      notes: optional(v.notes),
    });

  const selectedClient = clients.data?.find((c) => String(c.id) === form.values.clientId);

  return (
    <form onSubmit={form.onSubmit(submit)} noValidate autoComplete="off">
      <Stack>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label="Nome" required data-autofocus maxLength={200} placeholder="Painel do firewall" {...form.getInputProps('name')} />
          <TextInput label="Usuário" maxLength={200} autoComplete="off" {...form.getInputProps('username')} />
          <PasswordInput
            label="Senha ou segredo"
            required={!editing}
            description={editing ? 'Deixe em branco para manter o atual.' : undefined}
            autoComplete="new-password"
            {...form.getInputProps('secret')}
          />
          <TextInput label="Endereço (URL)" placeholder="https://192.168.1.1" {...form.getInputProps('url')} />
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
              form.setFieldValue('assetId', null);
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
        </SimpleGrid>
        <AssetSearchSelect
          key={form.values.clientId ?? 'sem-cliente'}
          label="Ativo"
          description="Opcional. A credencial aparece na ficha do ativo."
          clientId={selectedClient?.id}
          disabled={!selectedClient}
          value={form.values.assetId}
          currentLabel={credential?.assetName}
          onChange={(value) => form.setFieldValue('assetId', value)}
        />
        <Textarea label="Observações" autosize minRows={2} maxRows={6} {...form.getInputProps('notes')} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            {credential ? 'Salvar alterações' : 'Cadastrar credencial'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
