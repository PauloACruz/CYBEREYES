import { useState } from 'react';
import { Button, Checkbox, Group, Modal, Select, Stack, Switch, TagsInput, Textarea, TextInput } from '@mantine/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { faqApi } from '../../../api/assistant';
import { queryKeys } from '../../../api/queryKeys';
import type { FaqEntryDto, SaveFaqRequest } from '../../../api/types';
import { notifySuccess } from '../../../lib/feedback';
import { useClients } from '../../clients/useClients';

export const GUIDE_TAG = 'orientar';

interface Props {
  opened: boolean;
  onClose: () => void;
  /** Entrada a editar; nulo cria uma nova. */
  entry: FaqEntryDto | null;
  defaultClientId: number | undefined;
}

function FaqForm({ entry, defaultClientId, onClose }: Omit<Props, 'opened'>) {
  const queryClient = useQueryClient();
  const clients = useClients();
  const [question, setQuestion] = useState(entry?.question ?? '');
  const [answer, setAnswer] = useState(entry?.answer ?? '');
  const [clientId, setClientId] = useState<string | null>(entry ? (entry.clientId ? String(entry.clientId) : null) : defaultClientId ? String(defaultClientId) : null);
  const [tags, setTags] = useState<string[]>(entry?.tags.filter((t) => t !== GUIDE_TAG) ?? []);
  const [guides, setGuides] = useState(entry?.guides ?? false);
  const [enabled, setEnabled] = useState(entry?.enabled ?? true);

  const questionError = question.trim().length > 0 && question.trim().length < 3 ? 'Use pelo menos 3 caracteres' : undefined;
  const canSave = question.trim().length >= 3 && answer.trim().length > 0;

  const save = useMutation({
    mutationFn: () => {
      const body: SaveFaqRequest = {
        clientId: clientId ? Number(clientId) : null,
        question: question.trim(),
        answer: answer.trim(),
        tags: guides ? [GUIDE_TAG, ...tags] : tags,
        enabled,
      };
      return entry ? faqApi.update(entry.id, body) : faqApi.create(body);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.faq });
      notifySuccess(entry ? 'Entrada do FAQ atualizada.' : 'Entrada do FAQ criada.');
      onClose();
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave) save.mutate();
      }}
    >
      <Stack gap="md">
        <TextInput
          label="Problema ou pergunta"
          description="Como o usuário costuma descrever o problema."
          placeholder="A impressora não imprime"
          value={question}
          maxLength={300}
          onChange={(e) => setQuestion(e.currentTarget.value)}
          error={questionError}
          required
          data-autofocus
        />
        <Textarea
          label="Resposta"
          description="O passo a passo da solução, um passo por linha. Com a tag orientar, vai ao usuário exatamente como está aqui."
          placeholder={'1. Abra Configurações > Impressoras\n2. ...'}
          autosize
          minRows={6}
          maxRows={16}
          maxLength={20000}
          value={answer}
          onChange={(e) => setAnswer(e.currentTarget.value)}
          required
        />
        <Checkbox
          label="Orientar: o assistente envia este passo a passo ao usuário no chat"
          description="Sem esta tag a entrada só ajuda a equipe: o assistente cita a entrada na nota interna e encaminha o chamado."
          checked={guides}
          onChange={(e) => setGuides(e.currentTarget.checked)}
        />
        <TagsInput
          label="Outras tags"
          description="Digite e tecle Enter, por exemplo impressora, rede, e-mail."
          value={tags}
          onChange={(v) => setTags(v.map((t) => t.trim().toLowerCase()).filter((t) => t && t !== GUIDE_TAG))}
          clearable
        />
        <Select
          label="Cliente"
          description="Sem cliente, a entrada vale para todos."
          placeholder="Todos os clientes"
          clearable
          searchable
          data={(clients.data ?? []).map((c) => ({ value: String(c.id), label: c.name }))}
          value={clientId}
          onChange={setClientId}
        />
        <Switch label="Ativa" checked={enabled} onChange={(e) => setEnabled(e.currentTarget.checked)} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending} disabled={!canSave}>
            Salvar
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

export function FaqFormModal({ opened, onClose, entry, defaultClientId }: Props) {
  return (
    <Modal opened={opened} onClose={onClose} title={entry ? 'Editar entrada do FAQ' : 'Nova entrada do FAQ'} size="lg">
      {opened && <FaqForm key={entry?.id ?? 'novo'} entry={entry} defaultClientId={defaultClientId} onClose={onClose} />}
    </Modal>
  );
}
