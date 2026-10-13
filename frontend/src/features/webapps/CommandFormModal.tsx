import { Button, Group, Menu, Modal, NumberInput, Stack, Switch, Textarea, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconChevronDown, IconTemplate } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import type { AppCommandDto, SaveAppCommandRequest } from '../../api/types';
import { appCommandsApi } from '../../api/webapps';
import { notifySuccess } from '../../lib/feedback';
import { applyServerErrors } from '../../lib/forms';
import { optional } from '../inventory/inventoryFormat';
import { COMMAND_TEMPLATES } from './webappFormat';

interface CommandFormModalProps {
  opened: boolean;
  onClose: () => void;
  command: AppCommandDto | null;
  /** Dono de um comando novo: o servidor ou a aplicacao (roda na pasta dela). */
  owner: { serverId: number } | { webAppId: number };
}

export function CommandFormModal({ opened, onClose, command, owner }: CommandFormModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} title={command ? 'Editar comando' : 'Novo comando salvo'} size="lg" centered>
      {opened && <CommandForm onClose={onClose} command={command} owner={owner} />}
    </Modal>
  );
}

interface FormValues {
  name: string;
  script: string;
  description: string;
  confirm: boolean;
  timeoutMinutes: number | string;
}

function CommandForm({ onClose, command, owner }: Omit<CommandFormModalProps, 'opened'>) {
  const queryClient = useQueryClient();
  const form = useForm<FormValues>({
    initialValues: {
      name: command?.name ?? '',
      script: command?.script ?? '',
      description: command?.description ?? '',
      confirm: command?.confirm ?? false,
      timeoutMinutes: command?.timeoutMinutes ?? 10,
    },
    validate: {
      name: (v) => (v.trim() ? null : 'Informe o nome'),
      script: (v) => (v.trim() ? null : 'Informe o comando'),
      timeoutMinutes: (v) => (Number(v) >= 1 && Number(v) <= 240 ? null : 'Entre 1 e 240 minutos'),
    },
  });

  const save = useMutation({
    mutationFn: (v: FormValues) => {
      const target = command ? { serverId: command.serverId, webAppId: command.webAppId } : 'serverId' in owner
        ? { serverId: owner.serverId, webAppId: null }
        : { serverId: null, webAppId: owner.webAppId };
      const body: SaveAppCommandRequest = {
        ...target,
        name: v.name.trim(),
        script: v.script,
        description: optional(v.description),
        confirm: v.confirm,
        timeoutMinutes: Number(v.timeoutMinutes),
        sortOrder: command?.sortOrder,
      };
      return command ? appCommandsApi.update(command.id, body) : appCommandsApi.create(body);
    },
    onSuccess: () => {
      notifySuccess(command ? 'Comando atualizado.' : 'Comando salvo.');
      void queryClient.invalidateQueries({ queryKey: queryKeys.appCommands });
      onClose();
    },
    onError: (error) => applyServerErrors(form, error),
  });

  return (
    <form onSubmit={form.onSubmit((v) => save.mutate(v))} noValidate autoComplete="off">
      <Stack>
        <Group align="flex-end" gap="sm">
          <TextInput label="Nome" required data-autofocus maxLength={200} placeholder="Reiniciar containers" style={{ flex: 1 }} {...form.getInputProps('name')} />
          {!command && (
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <Button variant="light" leftSection={<IconTemplate size={16} />} rightSection={<IconChevronDown size={14} />}>
                  Sugestões
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                {COMMAND_TEMPLATES.map((t) => (
                  <Menu.Item
                    key={t.name}
                    onClick={() => form.setValues({ name: t.name, script: t.script, confirm: t.confirm ?? false })}
                  >
                    {t.name}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
          )}
        </Group>
        <Textarea
          label="Comando"
          description={
            'webAppId' in owner || command?.webAppId
              ? 'Roda em bash na pasta da aplicação. Pode ter várias linhas.'
              : 'Roda em bash na pasta do usuário SSH. Pode ter várias linhas.'
          }
          required
          autosize
          minRows={3}
          maxRows={14}
          spellCheck={false}
          styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)', fontSize: 13 } }}
          {...form.getInputProps('script')}
        />
        <TextInput label="Descrição" maxLength={1000} {...form.getInputProps('description')} />
        <Group grow align="flex-start">
          <Switch
            label="Pedir confirmação antes de rodar"
            description="Para reinícios, limpezas e outros comandos que mudam o servidor."
            {...form.getInputProps('confirm', { type: 'checkbox' })}
          />
          <NumberInput label="Tempo limite" min={1} max={240} allowDecimal={false} suffix=" min" {...form.getInputProps('timeoutMinutes')} />
        </Group>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending}>
            {command ? 'Salvar alterações' : 'Salvar comando'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
