import { useState } from 'react';
import { Alert, Autocomplete, Button, Checkbox, Group, Modal, Select, Stack, Switch, TagsInput, Textarea, TextInput } from '@mantine/core';
import { IconAlertTriangle, IconSparkles } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { faqApi } from '../../api/assistant';
import { queryKeys } from '../../api/queryKeys';
import { PERMISSIONS, type FaqDraftDto, type FaqEntryDto, type FaqStatus, type SaveFaqRequest } from '../../api/types';
import { hasPermission } from '../../auth/permissions';
import { useMe } from '../../auth/useMe';
import { notifySuccess } from '../../lib/feedback';
import { useClients } from '../clients/useClients';
import { GUIDE_TAG } from './faqFormat';

/** Valores iniciais de uma entrada nova (a partir de um chamado resolvido ou de uma análise de logs). */
export interface FaqPrefill {
  question?: string;
  answer?: string;
  category?: string | null;
  tags?: string[];
  clientId?: number | null;
  sourceTicketId?: number | null;
}

interface Props {
  opened: boolean;
  onClose: () => void;
  /** Entrada a editar ou sugestão a revisar; nulo cria uma nova. */
  entry: FaqEntryDto | null;
  prefill?: FaqPrefill;
  defaultClientId?: number;
}

function modalTitle(entry: FaqEntryDto | null, canManage: boolean): string {
  if (entry) return entry.status === 'proposed' ? 'Revisar sugestão do FAQ' : 'Editar entrada do FAQ';
  return canManage ? 'Nova entrada do FAQ' : 'Sugerir entrada do FAQ';
}

function successMessage(entry: FaqEntryDto | null, status: FaqStatus): string {
  if (status === 'proposed') return entry ? 'Sugestão atualizada.' : 'Sugestão enviada. Ela fica em Sugestões até alguém revisar.';
  if (entry?.status === 'proposed') return 'Entrada do FAQ publicada.';
  return entry ? 'Entrada do FAQ atualizada.' : 'Entrada do FAQ criada.';
}

function initialClientId(entry: FaqEntryDto | null, prefill: FaqPrefill | undefined, defaultClientId: number | undefined): string | null {
  const value = entry ? entry.clientId : prefill?.clientId !== undefined ? prefill.clientId : (defaultClientId ?? null);
  return value ? String(value) : null;
}

function FaqForm({ entry, prefill, defaultClientId, onClose }: Omit<Props, 'opened'>) {
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const canManage = hasPermission(me, PERMISSIONS.docsManage);
  const clients = useClients();
  const overview = useQuery({ queryKey: queryKeys.faqOverview(), queryFn: () => faqApi.overview() });
  const [question, setQuestion] = useState(entry?.question ?? prefill?.question ?? '');
  const [answer, setAnswer] = useState(entry?.answer ?? prefill?.answer ?? '');
  const [category, setCategory] = useState(entry?.category ?? prefill?.category ?? '');
  const [clientId, setClientId] = useState<string | null>(initialClientId(entry, prefill, defaultClientId));
  const [tags, setTags] = useState<string[]>((entry?.tags ?? prefill?.tags ?? []).filter((t) => t !== GUIDE_TAG));
  const [guides, setGuides] = useState(entry?.guides ?? prefill?.tags?.includes(GUIDE_TAG) ?? false);
  const [isPublic, setIsPublic] = useState(entry?.public ?? false);
  const [enabled, setEnabled] = useState(entry?.enabled ?? true);
  const [draft, setDraft] = useState<FaqDraftDto | null>(null);
  const sourceTicketId = entry?.sourceTicketId ?? prefill?.sourceTicketId ?? null;

  const questionError = question.trim().length > 0 && question.trim().length < 3 ? 'Use pelo menos 3 caracteres' : undefined;
  const canSuggest = question.trim().length >= 3;
  const canPublish = canSuggest && answer.trim().length > 0;

  const save = useMutation({
    mutationFn: (status: FaqStatus) => {
      const body: SaveFaqRequest = {
        clientId: clientId ? Number(clientId) : null,
        question: question.trim(),
        answer: answer.trim(),
        tags: guides ? [GUIDE_TAG, ...tags] : tags,
        enabled,
        category: category.trim() || null,
        status,
        public: isPublic,
        sourceTicketId,
      };
      return entry ? faqApi.update(entry.id, body) : faqApi.create(body);
    },
    onSuccess: async (_saved, status) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.faq });
      notifySuccess(successMessage(entry, status));
      onClose();
    },
  });

  const write = useMutation({
    mutationFn: () => faqApi.draft({ question: question.trim() || null, context: answer.trim() || null, ticketId: sourceTicketId }),
    onSuccess: (result) => {
      setDraft(result);
      // De um chamado, a pergunta generalizada do assistente substitui o titulo; a pergunta escrita pelo tecnico fica.
      if (result.question && (!question.trim() || (sourceTicketId !== null && !entry))) setQuestion(result.question);
      if (result.answer) setAnswer(result.answer);
      if (!category.trim() && result.category) setCategory(result.category);
      setTags((current) => [...new Set([...current, ...result.tags.filter((t) => t !== GUIDE_TAG)])]);
      setGuides(result.guides);
      setIsPublic(result.public);
      if (!entry && prefill?.clientId !== undefined && !result.clientSpecific) setClientId(null);
    },
  });

  const reviewing = !entry || entry.status === 'proposed';
  const submit = (target: FaqStatus) => {
    if (target === 'published' ? canPublish : canSuggest) save.mutate(target);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(canManage ? 'published' : 'proposed');
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
          description={
            canManage
              ? 'O passo a passo da solução, um passo por linha. Com a tag orientar, vai ao usuário exatamente como está aqui.'
              : 'Se souber a solução, escreva o passo a passo. Pode deixar em branco: a equipe responde ao revisar.'
          }
          placeholder={'1. Abra Configurações > Impressoras\n2. ...'}
          autosize
          minRows={6}
          maxRows={16}
          maxLength={20000}
          value={answer}
          onChange={(e) => setAnswer(e.currentTarget.value)}
        />
        {canManage && overview.data?.assistant && (
          <Group justify="flex-end" mt={-8}>
            <Button
              variant="light"
              color="teal"
              size="xs"
              leftSection={<IconSparkles size={14} />}
              loading={write.isPending}
              disabled={!canSuggest && sourceTicketId === null}
              onClick={() => write.mutate()}
            >
              {answer.trim() ? 'Melhorar com IA' : 'Escrever com IA'}
            </Button>
          </Group>
        )}
        {draft && (
          <Alert color="teal" variant="light" icon={<IconSparkles size={16} />} title="Rascunho do assistente">
            {draft.reason || 'Revise o texto antes de salvar.'}
          </Alert>
        )}
        {draft?.duplicateOf != null && (
          <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={16} />} title="Já existe uma entrada parecida">
            #{draft.duplicateOf} {draft.duplicateQuestion}
          </Alert>
        )}
        <Autocomplete
          label="Categoria"
          description="O assunto, para achar a entrada no FAQ e na ajuda do app."
          placeholder="Impressoras"
          data={overview.data?.allCategories ?? []}
          value={category}
          maxLength={80}
          onChange={setCategory}
        />
        <Checkbox
          label="Orientar: o assistente envia este passo a passo ao usuário no chat"
          description="Sem esta tag a entrada só ajuda a equipe: o assistente cita a entrada na nota interna e encaminha o chamado."
          checked={guides}
          onChange={(e) => setGuides(e.currentTarget.checked)}
        />
        <Checkbox
          label="Mostrar na ajuda do app EYES"
          description="Os usuários encontram a resposta em Ajuda, no app instalado no computador, e dizem se resolveu."
          checked={isPublic}
          onChange={(e) => setIsPublic(e.currentTarget.checked)}
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
          {!canManage && (
            <Button type="submit" loading={save.isPending} disabled={!canSuggest}>
              Enviar sugestão
            </Button>
          )}
          {canManage && !reviewing && (
            <Button type="submit" loading={save.isPending} disabled={!canPublish}>
              Salvar
            </Button>
          )}
          {canManage && reviewing && (
            <>
              <Button
                variant="default"
                loading={save.isPending && save.variables === 'proposed'}
                disabled={!canSuggest || (save.isPending && save.variables === 'published')}
                onClick={() => submit('proposed')}
              >
                Salvar como sugestão
              </Button>
              <Button
                type="submit"
                loading={save.isPending && save.variables === 'published'}
                disabled={!canPublish || (save.isPending && save.variables === 'proposed')}
              >
                Publicar
              </Button>
            </>
          )}
        </Group>
      </Stack>
    </form>
  );
}

export function FaqFormModal({ opened, onClose, entry, prefill, defaultClientId }: Props) {
  const { data: me } = useMe();
  const canManage = hasPermission(me, PERMISSIONS.docsManage);
  return (
    <Modal opened={opened} onClose={onClose} title={modalTitle(entry, canManage)} size="lg">
      {opened && <FaqForm key={entry?.id ?? 'novo'} entry={entry} prefill={prefill} defaultClientId={defaultClientId} onClose={onClose} />}
    </Modal>
  );
}
