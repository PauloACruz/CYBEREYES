import { Alert, Button, Checkbox, Fieldset, Group, Modal, Skeleton, Stack, Switch, Text, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rolesApi } from '../../api/roles';
import type { PermissionDto, RoleDto } from '../../api/types';
import { LoadError } from '../../components/TableStates';
import { notifySuccess } from '../../lib/feedback';
import { applyServerErrors } from '../../lib/forms';

interface RoleFormModalProps {
  opened: boolean;
  role: RoleDto | null;
  onClose: () => void;
}

export function RoleFormModal({ opened, role, onClose }: RoleFormModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} title={role ? 'Editar papel' : 'Novo papel'} centered size="lg">
      {opened && <RoleForm key={role?.id ?? 'new'} role={role} onDone={onClose} />}
    </Modal>
  );
}

function groupPermissions(permissions: PermissionDto[]): [string, PermissionDto[]][] {
  const groups = new Map<string, PermissionDto[]>();
  for (const p of permissions) {
    const list = groups.get(p.group);
    if (list) list.push(p);
    else groups.set(p.group, [p]);
  }
  return [...groups.entries()];
}

function RoleForm({ role, onDone }: { role: RoleDto | null; onDone: () => void }) {
  const queryClient = useQueryClient();
  const catalog = useQuery({ queryKey: ['roles', 'permissions'], queryFn: rolesApi.permissions, staleTime: 5 * 60_000 });
  const form = useForm({
    initialValues: {
      name: role?.name ?? '',
      isSuperuser: role?.isSuperuser ?? false,
      permissions: role?.permissions ?? [],
    },
    validate: { name: (v) => (v.trim() ? null : 'Informe o nome do papel') },
  });

  const save = useMutation({
    mutationFn: (values: typeof form.values) => {
      const body = { ...values, name: values.name.trim() };
      return role ? rolesApi.update(role.id, body) : rolesApi.create(body);
    },
    onSuccess: async () => {
      notifySuccess(role ? 'Papel atualizado.' : 'Papel criado.');
      await queryClient.invalidateQueries({ queryKey: ['roles'] });
      onDone();
    },
    onError: (error) => applyServerErrors(form, error),
  });

  return (
    <form onSubmit={form.onSubmit((values) => save.mutate(values))} noValidate>
      <Stack>
        <TextInput label="Nome" required data-autofocus {...form.getInputProps('name')} />
        <Switch
          label="Superusuário"
          description="Concede todas as permissões, inclusive as que forem criadas no futuro."
          {...form.getInputProps('isSuperuser', { type: 'checkbox' })}
        />
        {form.values.isSuperuser ? (
          <Alert variant="light" color="blue">
            Este papel tem acesso total. A seleção individual de permissões não se aplica.
          </Alert>
        ) : (
          <Stack gap="sm">
            <Text fw={500} size="sm">
              Permissões
            </Text>
            {catalog.isPending && <Skeleton h={120} />}
            {catalog.isError && <LoadError error={catalog.error} onRetry={() => void catalog.refetch()} />}
            {catalog.data && (
              <Checkbox.Group {...form.getInputProps('permissions')}>
                <Stack gap="sm">
                  {groupPermissions(catalog.data).map(([group, items]) => (
                    <Fieldset key={group} legend={group} variant="filled">
                      <Stack gap="xs">
                        {items.map((p) => (
                          <Checkbox key={p.key} value={p.key} label={p.description} description={p.key} />
                        ))}
                      </Stack>
                    </Fieldset>
                  ))}
                </Stack>
              </Checkbox.Group>
            )}
          </Stack>
        )}
        <Group justify="flex-end" mt="sm">
          <Button variant="default" onClick={onDone}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            {role ? 'Salvar' : 'Criar papel'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
