import { Alert, Autocomplete, Button, Center, Checkbox, Code, Grid, Group, Loader, Modal, NumberInput, Select, Stack, Switch, Text, Textarea, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconPuzzle } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import { scriptsApi } from '../../api/scripts';
import type { SaveScriptRequest, ScriptDto, ScriptPlatform, ScriptShell } from '../../api/types';
import { StringListInput } from '../../components/StringListInput';
import { LoadError } from '../../components/TableStates';
import { notifySuccess } from '../../lib/feedback';
import { applyServerErrors } from '../../lib/forms';
import { LazyCodeEditor } from './editor/LazyCodeEditor';
import { editorLanguage, SCRIPT_PLATFORMS, SCRIPT_SHELLS } from './scriptMeta';
import { TemplateVariablesHint } from './TemplateVariablesHint';

export type ScriptEditorTarget = { mode: 'create' } | { mode: 'edit'; id: number };

interface ScriptEditorModalProps {
  target: ScriptEditorTarget | null;
  readOnly: boolean;
  categories: string[];
  onClose: () => void;
}

export function ScriptEditorModal({ target, readOnly, categories, onClose }: ScriptEditorModalProps) {
  const title = !target ? '' : target.mode === 'create' ? 'Novo script' : readOnly ? 'Ver script' : 'Editar script';
  return (
    <Modal opened={target !== null} onClose={onClose} title={title} size="80rem" centered={false} closeOnClickOutside={false}>
      {target?.mode === 'create' && <ScriptForm initial={null} readOnly={false} categories={categories} onClose={onClose} />}
      {target?.mode === 'edit' && <EditLoader id={target.id} readOnly={readOnly} categories={categories} onClose={onClose} />}
    </Modal>
  );
}

function EditLoader({ id, readOnly, categories, onClose }: { id: number; readOnly: boolean; categories: string[]; onClose: () => void }) {
  const script = useQuery({ queryKey: queryKeys.script(id), queryFn: () => scriptsApi.get(id) });
  if (script.isError) return <LoadError error={script.error} onRetry={() => void script.refetch()} />;
  if (!script.data) {
    return (
      <Center py="xl">
        <Loader aria-label="Carregando script" />
      </Center>
    );
  }
  return <ScriptForm key={script.data.updatedAt} initial={script.data} readOnly={readOnly} categories={categories} onClose={onClose} />;
}

function defaultPlatforms(shell: ScriptShell): ScriptPlatform[] {
  if (shell === 'powershell' || shell === 'cmd') return ['windows'];
  if (shell === 'shell') return ['linux', 'darwin'];
  return ['windows', 'linux', 'darwin'];
}

function toForm(script: ScriptDto | null): SaveScriptRequest {
  if (!script) {
    return {
      name: '',
      description: '',
      category: '',
      shell: 'powershell',
      body: '',
      defaultArgs: [],
      envVars: [],
      defaultTimeout: 90,
      runAsUser: false,
      platforms: ['windows'],
    };
  }
  return {
    name: script.name,
    description: script.description,
    category: script.category,
    shell: script.shell,
    body: script.body ?? '',
    defaultArgs: script.defaultArgs,
    envVars: script.envVars,
    defaultTimeout: script.defaultTimeout,
    runAsUser: script.runAsUser,
    platforms: script.platforms,
  };
}

interface ScriptFormProps {
  initial: ScriptDto | null;
  readOnly: boolean;
  categories: string[];
  onClose: () => void;
}

function ScriptForm({ initial, readOnly, categories, onClose }: ScriptFormProps) {
  const queryClient = useQueryClient();
  const snippets = useQuery({ queryKey: queryKeys.snippets, queryFn: scriptsApi.snippets });
  const form = useForm<SaveScriptRequest>({
    initialValues: toForm(initial),
    validate: {
      name: (v) => (v.trim() ? null : 'Informe o nome'),
      body: (v) => (v.trim() ? null : 'O script está vazio'),
      platforms: (v) => (v.length > 0 ? null : 'Escolha ao menos uma plataforma'),
      defaultTimeout: (v) => (Number.isInteger(v) && v >= 5 && v <= 86400 ? null : 'Entre 5 e 86400 segundos'),
      envVars: (v) => (v.every((e) => e.trim() === '' || /^[^=\s]+=/.test(e.trim())) ? null : 'Use o formato NOME=valor'),
    },
  });

  const save = useMutation({
    mutationFn: (body: SaveScriptRequest) => (initial ? scriptsApi.update(initial.id, body) : scriptsApi.create(body)),
    onSuccess: async (saved) => {
      notifySuccess(initial ? `Script ${saved.name} atualizado.` : `Script ${saved.name} criado.`);
      await queryClient.invalidateQueries({ queryKey: queryKeys.scripts });
      onClose();
    },
    onError: (error) => applyServerErrors(form, error),
  });

  const submit = form.onSubmit((values) =>
    save.mutate({
      ...values,
      name: values.name.trim(),
      category: values.category.trim(),
      defaultArgs: values.defaultArgs.filter((a) => a.trim() !== ''),
      envVars: values.envVars.map((e) => e.trim()).filter(Boolean),
    }),
  );

  const changeShell = (value: string | null) => {
    const shell = SCRIPT_SHELLS.find((s) => s.value === value)?.value;
    if (!shell) return;
    form.setFieldValue('shell', shell);
    if (!initial) form.setFieldValue('platforms', defaultPlatforms(shell));
  };

  return (
    <form onSubmit={submit} noValidate>
      <Grid gap="lg">
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Stack gap="xs">
            <Text size="sm" fw={500}>
              Código
            </Text>
            <LazyCodeEditor
              value={form.values.body}
              onChange={(v) => form.setFieldValue('body', v)}
              language={editorLanguage(form.values.shell)}
              readOnly={readOnly}
              height="60vh"
              ariaLabel="Código do script"
            />
            {form.errors.body && (
              <Text size="xs" c="red">
                {form.errors.body}
              </Text>
            )}
            {snippets.data && snippets.data.length > 0 && (
              <Alert variant="light" color="gray" icon={<IconPuzzle size={18} />} p="xs">
                <Text size="xs">
                  Snippets disponíveis (escreva o nome entre chaves duplas no código):{' '}
                  {snippets.data.map((s, i) => (
                    <span key={s.id}>
                      {i > 0 && ', '}
                      <Code>{`{{${s.name}}}`}</Code>
                    </span>
                  ))}
                </Text>
              </Alert>
            )}
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Stack>
            <TextInput label="Nome" required disabled={readOnly} maxLength={255} {...form.getInputProps('name')} />
            <Textarea label="Descrição" autosize minRows={2} maxRows={5} disabled={readOnly} {...form.getInputProps('description')} />
            <Autocomplete
              label="Categoria"
              placeholder="Sem categoria"
              disabled={readOnly}
              data={categories}
              maxLength={100}
              {...form.getInputProps('category')}
            />
            <Select
              label="Shell"
              required
              allowDeselect={false}
              disabled={readOnly}
              data={SCRIPT_SHELLS.map((s) => ({ value: s.value, label: s.label }))}
              value={form.values.shell}
              onChange={changeShell}
            />
            <Checkbox.Group label="Plataformas" required {...form.getInputProps('platforms')}>
              <Group mt={6}>
                {SCRIPT_PLATFORMS.map((p) => (
                  <Checkbox key={p.value} value={p.value} label={p.label} disabled={readOnly} />
                ))}
              </Group>
            </Checkbox.Group>
            <NumberInput
              label="Tempo limite padrão (segundos)"
              min={5}
              max={86400}
              allowDecimal={false}
              disabled={readOnly}
              {...form.getInputProps('defaultTimeout')}
            />
            <Switch
              label="Executar como o usuário logado (Windows)"
              disabled={readOnly}
              {...form.getInputProps('runAsUser', { type: 'checkbox' })}
            />
            <StringListInput
              label="Argumentos padrão"
              addLabel="Adicionar argumento"
              placeholder="-Parametro valor"
              disabled={readOnly}
              value={form.values.defaultArgs}
              onChange={(v) => form.setFieldValue('defaultArgs', v)}
            />
            <StringListInput
              label="Variáveis de ambiente"
              description="No formato NOME=valor"
              addLabel="Adicionar variável"
              placeholder="NOME=valor"
              disabled={readOnly}
              value={form.values.envVars}
              onChange={(v) => form.setFieldValue('envVars', v)}
            />
            {form.errors.envVars && (
              <Text size="xs" c="red">
                {form.errors.envVars}
              </Text>
            )}
            <TemplateVariablesHint context="nos argumentos e nas variáveis de ambiente" />
          </Stack>
        </Grid.Col>
      </Grid>
      <Group justify="flex-end" mt="lg">
        <Button variant="default" onClick={onClose}>
          {readOnly ? 'Fechar' : 'Cancelar'}
        </Button>
        {!readOnly && (
          <Button type="submit" loading={save.isPending}>
            {initial ? 'Salvar alterações' : 'Criar script'}
          </Button>
        )}
      </Group>
    </form>
  );
}
