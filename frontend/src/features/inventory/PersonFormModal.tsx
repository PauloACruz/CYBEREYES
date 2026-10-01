import { Button, Group, Modal, Select, SimpleGrid, Stack, Switch, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { peopleApi } from '../../api/inventory';
import { queryKeys } from '../../api/queryKeys';
import type { SavePersonRequest } from '../../api/types';
import { notifySuccess } from '../../lib/feedback';
import { applyServerErrors } from '../../lib/forms';
import { useClients } from '../clients/useClients';
import { optional } from './inventoryFormat';

export interface PersonFormSource {
  id: number;
  clientId: number;
  name: string;
  email: string | null;
  phone: string | null;
  department: string | null;
  jobTitle: string | null;
  username: string | null;
  active: boolean;
}

interface PersonFormModalProps {
  opened: boolean;
  onClose: () => void;
  person?: PersonFormSource;
}

export function PersonFormModal({ opened, onClose, person }: PersonFormModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} title={person ? 'Editar pessoa' : 'Nova pessoa'} size="lg" centered>
      {opened && <PersonForm onClose={onClose} person={person} />}
    </Modal>
  );
}

interface FormValues {
  clientId: string | null;
  name: string;
  email: string;
  phone: string;
  department: string;
  jobTitle: string;
  username: string;
  active: boolean;
}

function PersonForm({ onClose, person }: { onClose: () => void; person?: PersonFormSource }) {
  const queryClient = useQueryClient();
  const clients = useClients();
  const form = useForm<FormValues>({
    initialValues: {
      clientId: person ? String(person.clientId) : null,
      name: person?.name ?? '',
      email: person?.email ?? '',
      phone: person?.phone ?? '',
      department: person?.department ?? '',
      jobTitle: person?.jobTitle ?? '',
      username: person?.username ?? '',
      active: person?.active ?? true,
    },
    validate: {
      clientId: (v) => (v ? null : 'Escolha o cliente'),
      name: (v) => {
        const len = v.trim().length;
        if (len < 2) return 'Use pelo menos 2 caracteres';
        return len > 200 ? 'Use no máximo 200 caracteres' : null;
      },
      email: (v) => (!v.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? null : 'E-mail inválido'),
    },
  });

  const save = useMutation({
    mutationFn: (body: SavePersonRequest) => (person ? peopleApi.update(person.id, body) : peopleApi.create(body)),
    onSuccess: () => {
      notifySuccess(person ? 'Pessoa atualizada.' : 'Pessoa cadastrada.');
      void queryClient.invalidateQueries({ queryKey: queryKeys.people });
      void queryClient.invalidateQueries({ queryKey: queryKeys.assets });
      onClose();
    },
    onError: (error) => applyServerErrors(form, error),
  });

  const submit = (v: FormValues) =>
    save.mutate({
      clientId: Number(v.clientId),
      name: v.name.trim(),
      email: optional(v.email),
      phone: optional(v.phone),
      department: optional(v.department),
      jobTitle: optional(v.jobTitle),
      username: optional(v.username),
      active: v.active,
    });

  return (
    <form onSubmit={form.onSubmit(submit)} noValidate>
      <Stack>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label="Nome" required data-autofocus maxLength={200} {...form.getInputProps('name')} />
          <Select
            label="Cliente"
            required
            searchable
            data={(clients.data ?? []).map((c) => ({ value: String(c.id), label: c.name }))}
            {...form.getInputProps('clientId')}
          />
          <TextInput label="E-mail" type="email" maxLength={200} {...form.getInputProps('email')} />
          <TextInput label="Telefone" maxLength={50} {...form.getInputProps('phone')} />
          <TextInput label="Departamento" maxLength={200} {...form.getInputProps('department')} />
          <TextInput label="Cargo" maxLength={200} {...form.getInputProps('jobTitle')} />
          <TextInput
            label="Usuário no sistema"
            description="Login no Windows, Linux ou macOS. Usado para sugerir o responsável."
            placeholder="DOMINIO\\usuario ou usuario"
            maxLength={200}
            {...form.getInputProps('username')}
          />
        </SimpleGrid>
        <Switch
          label="Ativa"
          description="Pessoas inativas não aparecem para atribuição."
          {...form.getInputProps('active', { type: 'checkbox' })}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            {person ? 'Salvar alterações' : 'Cadastrar pessoa'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
