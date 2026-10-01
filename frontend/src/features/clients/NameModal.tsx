import { Button, Group, Modal, Stack, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useMutation } from '@tanstack/react-query';
import { applyServerErrors } from '../../lib/forms';

export interface NameModalConfig {
  title: string;
  label: string;
  submitLabel: string;
  initialName: string;
  save: (name: string) => Promise<unknown>;
}

interface NameModalProps {
  config: NameModalConfig | null;
  onClose: () => void;
}

/** Modal com um unico campo de nome, usado para renomear cliente/site e adicionar site. */
export function NameModal({ config, onClose }: NameModalProps) {
  return (
    <Modal opened={config !== null} onClose={onClose} title={config?.title} centered>
      {config && <NameForm key={config.title + config.initialName} config={config} onClose={onClose} />}
    </Modal>
  );
}

function NameForm({ config, onClose }: { config: NameModalConfig; onClose: () => void }) {
  const form = useForm({
    initialValues: { name: config.initialName },
    validate: { name: (v) => (v.trim() ? null : 'Informe o nome') },
  });
  const save = useMutation({
    mutationFn: (name: string) => config.save(name),
    onSuccess: onClose,
    onError: (error) => applyServerErrors(form, error),
  });
  return (
    <form onSubmit={form.onSubmit((values) => save.mutate(values.name.trim()))} noValidate>
      <Stack>
        <TextInput label={config.label} required data-autofocus maxLength={255} {...form.getInputProps('name')} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            {config.submitLabel}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
