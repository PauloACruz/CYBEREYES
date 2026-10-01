import { Button, Group, Modal, Stack, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clientsApi } from '../../api/clients';
import { queryKeys } from '../../api/queryKeys';
import { notifySuccess } from '../../lib/feedback';
import { applyServerErrors } from '../../lib/forms';

interface CreateClientModalProps {
  opened: boolean;
  onClose: () => void;
}

export function CreateClientModal({ opened, onClose }: CreateClientModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} title="Novo cliente" centered>
      {opened && <CreateClientForm onClose={onClose} />}
    </Modal>
  );
}

function CreateClientForm({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const form = useForm({
    initialValues: { name: '', siteName: '' },
    validate: {
      name: (v) => (v.trim() ? null : 'Informe o nome do cliente'),
      siteName: (v) => (v.trim() ? null : 'Informe o nome do primeiro site'),
    },
  });
  const create = useMutation({
    mutationFn: (values: typeof form.values) => clientsApi.create({ name: values.name.trim(), siteName: values.siteName.trim() }),
    onSuccess: async (client) => {
      notifySuccess(`Cliente ${client.name} criado.`);
      await queryClient.invalidateQueries({ queryKey: queryKeys.clients });
      onClose();
    },
    onError: (error) => applyServerErrors(form, error),
  });
  return (
    <form onSubmit={form.onSubmit((values) => create.mutate(values))} noValidate>
      <Stack>
        <TextInput label="Nome do cliente" required data-autofocus maxLength={255} {...form.getInputProps('name')} />
        <TextInput
          label="Nome do primeiro site"
          description="Um site é um local ou unidade do cliente, por exemplo: Matriz."
          required
          maxLength={255}
          {...form.getInputProps('siteName')}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={create.isPending}>
            Criar cliente
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
