import { useState } from 'react';
import { ActionIcon, Anchor, Badge, Button, FileInput, Group, Image, Paper, Select, Stack, Text, Textarea, Timeline, Tooltip } from '@mantine/core';
import { IconCalendarEvent, IconFile, IconMessage, IconPaperclip, IconProgressCheck, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { projectsApi, type ListProjectNotesParams, type ProjectDetail, type ProjectNote } from '../../api/projects';
import { queryKeys } from '../../api/queryKeys';
import { LoadError } from '../../components/TableStates';
import { confirmAction, notifySuccess } from '../../lib/feedback';
import { formatBytes, formatDateTime } from '../../lib/format';
import { ITEM_STATUS_COLORS, ITEM_STATUS_LABELS } from './projectFormat';
import { MAX_FILES, refreshProject, tooLarge, uploadAll } from './projectActions';

/** Valor do filtro "Sobre": "a:<id>" estação, "t:<id>" tarefa. */
function subjectOptions(project: ProjectDetail) {
  const groups = [];
  if (project.agents.length > 0) {
    groups.push({ group: 'Estações', items: project.agents.map((a) => ({ value: `a:${a.id}`, label: a.hostname })) });
  }
  if (project.tasks.length > 0) {
    groups.push({ group: 'Tarefas', items: project.tasks.map((t) => ({ value: `t:${t.id}`, label: t.title })) });
  }
  return groups;
}

function parseSubject(value: string | null): { projectAgentId?: number; projectTaskId?: number } {
  if (!value) return {};
  const id = Number(value.slice(2));
  return value.startsWith('a:') ? { projectAgentId: id } : { projectTaskId: id };
}

function Composer({ project }: { project: ProjectDetail }) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const [subject, setSubject] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const fileError = tooLarge(files);
  const save = useMutation({
    mutationFn: async () => {
      const ref = parseSubject(subject);
      const note = await projectsApi.addNote(project.id, { body: body.trim() || null, ...ref });
      return uploadAll(project.id, note.id, files);
    },
    onSuccess: (failed) => {
      refreshProject(queryClient, project.id);
      notifySuccess(failed > 0 ? `Registro salvo; ${failed} anexo(s) não foram enviados.` : 'Registro salvo.');
      setBody('');
      setFiles([]);
    },
  });
  return (
    <Paper withBorder p="sm">
      <Stack gap="xs">
        <Textarea
          placeholder="Registre o andamento: o que foi feito, decisões, pendências, peças trocadas…"
          aria-label="Registro"
          autosize
          minRows={2}
          maxRows={10}
          value={body}
          onChange={(e) => setBody(e.currentTarget.value)}
        />
        <Group gap="xs" align="flex-start" wrap="wrap">
          <Select
            placeholder="Sobre o projeto todo"
            aria-label="Sobre"
            clearable
            searchable
            data={subjectOptions(project)}
            value={subject}
            onChange={setSubject}
            w={240}
          />
          <FileInput
            placeholder="Fotos e arquivos"
            aria-label="Fotos e arquivos"
            multiple
            clearable
            leftSection={<IconPaperclip size={16} />}
            value={files}
            onChange={setFiles}
            error={fileError}
            style={{ flex: 1, minWidth: 200 }}
            title={`Até ${MAX_FILES} arquivos de até 10 MB`}
          />
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={(body.trim() === '' && files.length === 0) || fileError !== null}>
            Registrar
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}

const KIND_ICON = { note: IconMessage, status: IconProgressCheck, event: IconCalendarEvent } as const;

function NoteItem({ project, note }: { project: ProjectDetail; note: ProjectNote }) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => projectsApi.removeNote(project.id, note.id),
    onSuccess: () => {
      refreshProject(queryClient, project.id);
      notifySuccess('Registro excluído.');
    },
  });
  const images = note.attachments.filter((a) => a.contentType.startsWith('image/'));
  const others = note.attachments.filter((a) => !a.contentType.startsWith('image/'));
  return (
    <Stack gap={4}>
      <Group gap={6} wrap="wrap">
        <Text size="sm" fw={600}>
          {note.authorName}
        </Text>
        {note.subject && (
          <Text size="sm" c={note.kind === 'event' ? undefined : 'dimmed'} fw={note.kind === 'event' ? 600 : undefined}>
            {note.kind === 'event' ? note.subject : `· ${note.subject}`}
          </Text>
        )}
        {note.itemStatus && (
          <Badge size="xs" variant="light" color={ITEM_STATUS_COLORS[note.itemStatus]}>
            {ITEM_STATUS_LABELS[note.itemStatus]}
          </Badge>
        )}
        <Text size="xs" c="dimmed">
          {formatDateTime(note.createdAt)}
        </Text>
        {note.canDelete && (
          <Tooltip label="Excluir registro">
            <ActionIcon
              size="sm"
              variant="subtle"
              color="red"
              aria-label="Excluir registro"
              onClick={() =>
                confirmAction({
                  title: 'Excluir registro',
                  message: 'Excluir este registro e os anexos dele? A situação da estação ou tarefa não muda.',
                  confirmLabel: 'Excluir',
                  danger: true,
                  onConfirm: () => remove.mutate(),
                })
              }
            >
              <IconTrash size={14} />
            </ActionIcon>
          </Tooltip>
        )}
      </Group>
      {note.body && (
        <Text size="sm" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {note.body}
        </Text>
      )}
      {images.length > 0 && (
        <Group gap="xs">
          {images.map((a) => (
            <Anchor key={a.id} href={projectsApi.attachmentUrl(project.id, a.id)} target="_blank" rel="noreferrer" title={a.fileName}>
              <Image src={projectsApi.attachmentUrl(project.id, a.id)} alt={a.fileName} w={112} h={84} radius="sm" fit="cover" />
            </Anchor>
          ))}
        </Group>
      )}
      {others.map((a) => (
        <Group key={a.id} gap={6}>
          <IconFile size={14} />
          <Anchor href={projectsApi.attachmentUrl(project.id, a.id)} size="sm">
            {a.fileName}
          </Anchor>
          <Text size="xs" c="dimmed">
            {formatBytes(a.size)}
          </Text>
        </Group>
      ))}
    </Stack>
  );
}

export function ProjectJournal({ project }: { project: ProjectDetail }) {
  const recurring = project.recurrence !== 'none' || project.closedCycles > 0;
  const [cycle, setCycle] = useState<string | null>(recurring ? String(project.cycle) : null);
  const [subject, setSubject] = useState<string | null>(null);
  const params: ListProjectNotesParams = { cycle: cycle ? Number(cycle) : undefined, ...parseSubject(subject) };
  const notes = useQuery({ queryKey: queryKeys.projectNotes(project.id, params), queryFn: () => projectsApi.notes(project.id, params) });
  const cycles = Array.from({ length: project.cycle }, (_, i) => project.cycle - i).map((n) => ({
    value: String(n),
    label: n === project.cycle && (project.status === 'active' || project.status === 'paused') ? `Ciclo ${n} (atual)` : `Ciclo ${n}`,
  }));

  return (
    <Stack gap="sm">
      {project.can.record && <Composer project={project} />}
      <Group gap="xs" wrap="wrap">
        {recurring && <Select placeholder="Todos os ciclos" aria-label="Ciclo" clearable data={cycles} value={cycle} onChange={setCycle} w={180} />}
        <Select placeholder="Tudo" aria-label="Filtrar por estação ou tarefa" clearable searchable data={subjectOptions(project)} value={subject} onChange={setSubject} w={240} />
      </Group>
      {notes.isError && <LoadError error={notes.error} onRetry={() => void notes.refetch()} />}
      {notes.isSuccess && notes.data.length === 0 && (
        <Text size="sm" c="dimmed" ta="center" py="lg">
          Nada registrado {cycle ? 'neste ciclo' : 'ainda'}.
        </Text>
      )}
      {notes.isSuccess && notes.data.length > 0 && (
        <Timeline bulletSize={26} lineWidth={2} mt="xs">
          {notes.data.map((note) => {
            const Icon = KIND_ICON[note.kind];
            return (
              <Timeline.Item key={note.id} bullet={<Icon size={14} />}>
                <NoteItem project={project} note={note} />
              </Timeline.Item>
            );
          })}
        </Timeline>
      )}
    </Stack>
  );
}
