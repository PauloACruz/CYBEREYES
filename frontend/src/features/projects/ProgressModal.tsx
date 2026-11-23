import { useState } from 'react';
import { Button, FileInput, Group, Modal, Select, Stack, Text, Textarea } from '@mantine/core';
import { IconPaperclip } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { projectsApi, type ProjectAgent, type ProjectItemStatus, type ProjectTask } from '../../api/projects';
import { notifySuccess } from '../../lib/feedback';
import { MAX_FILES, refreshProject, tooLarge, uploadAll } from './projectActions';
import { ITEM_STATUS_OPTIONS } from './projectFormat';

/** O que muda de situação: uma ou mais estações, ou uma tarefa. */
export type ProgressTarget = { kind: 'agents'; rows: ProjectAgent[]; status?: ProjectItemStatus } | { kind: 'task'; task: ProjectTask; status?: ProjectItemStatus };

/** A estação, quando o registro é de uma só. */
function singleRow(target: ProgressTarget): ProjectAgent | undefined {
  return target.kind === 'agents' && target.rows.length === 1 ? target.rows[0] : undefined;
}

function title(target: ProgressTarget): string {
  if (target.kind === 'task') return target.task.title;
  return singleRow(target)?.hostname ?? `${target.rows.length} estações`;
}

function initialStatus(target: ProgressTarget): ProjectItemStatus {
  if (target.status) return target.status;
  const current = target.kind === 'task' ? target.task.status : (singleRow(target)?.status ?? 'pending');
  return current === 'pending' ? 'done' : current;
}

function ProgressForm({ projectId, target, onClose }: { projectId: number; target: ProgressTarget; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ProjectItemStatus>(initialStatus(target));
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const row = singleRow(target);
  const single = target.kind === 'task' || row !== undefined;
  const fileError = tooLarge(files);

  const save = useMutation({
    mutationFn: async () => {
      if (target.kind === 'agents' && row === undefined) {
        await projectsApi.progress(projectId, { agentRowIds: target.rows.map((r) => r.id), status, note: note.trim() || null });
        return 0;
      }
      const created = await projectsApi.addNote(projectId, {
        body: note.trim() || null,
        status,
        projectAgentId: row?.id ?? null,
        projectTaskId: target.kind === 'task' ? target.task.id : null,
      });
      return uploadAll(projectId, created.id, files);
    },
    onSuccess: (failed) => {
      refreshProject(queryClient, projectId);
      notifySuccess(failed > 0 ? `Andamento registrado; ${failed} anexo(s) não foram enviados.` : 'Andamento registrado.');
      onClose();
    },
  });

  return (
    <Stack gap="sm">
      <Select
        label="Situação"
        data={ITEM_STATUS_OPTIONS}
        allowDeselect={false}
        value={status}
        onChange={(value) => value && setStatus(value)}
      />
      <Textarea
        label="Observação"
        placeholder={target.kind === 'agents' ? 'O que foi feito, o que foi encontrado, peças trocadas…' : 'O que foi feito'}
        autosize
        minRows={3}
        maxRows={8}
        value={note}
        onChange={(e) => setNote(e.currentTarget.value)}
      />
      {single ? (
        <FileInput
          label="Fotos e arquivos"
          placeholder="Antes e depois, laudos, comprovantes…"
          multiple
          clearable
          leftSection={<IconPaperclip size={16} />}
          value={files}
          onChange={setFiles}
          error={fileError}
          description={`Até ${MAX_FILES} arquivos de até 10 MB.`}
        />
      ) : (
        <Text size="xs" c="dimmed">
          A observação vale para todas as estações escolhidas. Para anexar fotos, registre uma estação por vez ou use a aba Documentação.
        </Text>
      )}
      <Group justify="flex-end">
        <Button variant="default" onClick={onClose}>
          Cancelar
        </Button>
        <Button onClick={() => save.mutate()} loading={save.isPending} disabled={fileError !== null}>
          Registrar
        </Button>
      </Group>
    </Stack>
  );
}

interface ProgressModalProps {
  projectId: number;
  target: ProgressTarget | null;
  onClose: () => void;
  /** Tela cheia (app do celular). */
  fullScreen?: boolean;
}

export function ProgressModal({ projectId, target, onClose, fullScreen = false }: ProgressModalProps) {
  return (
    <Modal opened={target !== null} onClose={onClose} title={target ? `Registrar andamento: ${title(target)}` : ''} size="lg" fullScreen={fullScreen}>
      {target && <ProgressForm projectId={projectId} target={target} onClose={onClose} />}
    </Modal>
  );
}
