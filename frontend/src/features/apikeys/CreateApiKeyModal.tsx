import { useState } from 'react';
import { Alert, Button, Group, Modal, Stack, Text, TextInput } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { IconAlertTriangle } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { apiKeysApi } from '../../api/apikeys';
import type { CreatedApiKeyDto } from '../../api/types';
import { CopyField } from '../../components/CopyField';
import { formatDate } from '../../lib/format';
import { applyServerErrors } from '../../lib/forms';

interface CreateApiKeyModalProps {
  opened: boolean;
  onClose: () => void;
}

export function CreateApiKeyModal({ opened, onClose }: CreateApiKeyModalProps) {
  const [created, setCreated] = useState<CreatedApiKeyDto | null>(null);
  const close = () => {
    setCreated(null);
    onClose();
  };
  return (
    <Modal
      opened={opened}
      onClose={close}
      title={created ? 'Chave criada' : 'Nova chave de API'}
      centered
      size="lg"
      closeOnClickOutside={!created}
    >
      {opened && (created ? <CreatedKey apiKey={created} onDone={close} /> : <CreateForm onCreated={setCreated} onCancel={close} />)}
    </Modal>
  );
}

function CreateForm({ onCreated, onCancel }: { onCreated: (key: CreatedApiKeyDto) => void; onCancel: () => void }) {
  const queryClient = useQueryClient();
  const form = useForm<{ name: string; expiresAt: string | null }>({
    initialValues: { name: '', expiresAt: null },
    validate: { name: (v) => (v.trim() ? null : 'Informe um nome para identificar a chave') },
  });
  const create = useMutation({
    mutationFn: (values: typeof form.values) =>
      apiKeysApi.create({
        name: values.name.trim(),
        expiresAt: values.expiresAt ? dayjs(values.expiresAt).endOf('day').toISOString() : undefined,
      }),
    onSuccess: async (key) => {
      await queryClient.invalidateQueries({ queryKey: ['apikeys'] });
      onCreated(key);
    },
    onError: (error) => applyServerErrors(form, error),
  });

  return (
    <form onSubmit={form.onSubmit((values) => create.mutate(values))} noValidate>
      <Stack>
        <TextInput
          label="Nome"
          description="Use um nome que identifique a integração, por exemplo: Backup noturno."
          required
          data-autofocus
          {...form.getInputProps('name')}
        />
        <DateInput
          label="Expira em"
          description="Opcional. Sem data, a chave vale até ser revogada."
          placeholder="Sem validade"
          valueFormat="DD/MM/YYYY"
          clearable
          minDate={dayjs().add(1, 'day').format('YYYY-MM-DD')}
          {...form.getInputProps('expiresAt')}
        />
        <Group justify="flex-end" mt="sm">
          <Button variant="default" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" loading={create.isPending}>
            Criar chave
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

function CreatedKey({ apiKey, onDone }: { apiKey: CreatedApiKeyDto; onDone: () => void }) {
  return (
    <Stack>
      <Alert color="yellow" icon={<IconAlertTriangle size={18} />} title="Copie a chave agora">
        Por segurança, ela não será exibida novamente. Envie-a no cabeçalho X-API-KEY das requisições.
      </Alert>
      <Stack gap={4}>
        <Text size="sm" fw={500}>
          {apiKey.name}
        </Text>
        <CopyField value={apiKey.key} label="Copiar chave" />
        <Text size="xs" c="dimmed">
          Validade: {formatDate(apiKey.expiresAt)}
        </Text>
      </Stack>
      <Group justify="flex-end">
        <Button onClick={onDone}>Concluir</Button>
      </Group>
    </Stack>
  );
}
