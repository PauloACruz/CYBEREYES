import { ActionIcon, Anchor, Button, FileButton, Group, Image, Paper, Stack, Text, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconFileDownload, IconPaperclip, IconTrash } from '@tabler/icons-react';
import { useMutation } from '@tanstack/react-query';
import { docAttachmentsApi, docAttachmentUrl } from '../../api/docs';
import type { DocAttachmentDto, DocOwnerType } from '../../api/types';
import { formatBytes, formatDateTime } from '../../lib/format';
import { confirmAction, notifySuccess } from '../../lib/feedback';
import { isInlineImage, MAX_ATTACHMENT_BYTES } from '../tickets/ticketActions';

interface DocAttachmentsProps {
  ownerType: DocOwnerType;
  ownerId: number;
  attachments: DocAttachmentDto[];
  canManage: boolean;
  /** Chamado depois de enviar ou excluir, para recarregar a lista do dono. */
  onChanged: () => void;
}

export function DocAttachments({ ownerType, ownerId, attachments, canManage, onChanged }: DocAttachmentsProps) {
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      for (const file of files) await docAttachmentsApi.upload(ownerType, ownerId, file);
      return files.length;
    },
    onSuccess: (count) => notifySuccess(count === 1 ? 'Anexo enviado.' : `${count} anexos enviados.`),
    onSettled: onChanged,
  });

  const remove = useMutation({
    mutationFn: (id: number) => docAttachmentsApi.remove(id),
    onSuccess: () => {
      notifySuccess('Anexo excluído.');
      onChanged();
    },
  });

  const addFiles = (picked: File[]) => {
    const tooBig = picked.filter((f) => f.size > MAX_ATTACHMENT_BYTES);
    if (tooBig.length > 0) {
      notifications.show({
        color: 'red',
        title: 'Arquivo muito grande',
        message: `${tooBig.map((f) => f.name).join(', ')}: o limite é de 10 MB por arquivo.`,
      });
    }
    const accepted = picked.filter((f) => f.size <= MAX_ATTACHMENT_BYTES);
    if (accepted.length > 0) upload.mutate(accepted);
  };

  const images = attachments.filter((a) => isInlineImage(a.contentType));
  const files = attachments.filter((a) => !isInlineImage(a.contentType));

  const removeButton = (attachment: DocAttachmentDto) =>
    canManage && (
      <Tooltip label="Excluir anexo">
        <ActionIcon
          className="no-print"
          variant="subtle"
          color="red"
          size="sm"
          aria-label={`Excluir ${attachment.fileName}`}
          loading={remove.isPending && remove.variables === attachment.id}
          onClick={() =>
            confirmAction({
              title: 'Excluir anexo',
              message: `Excluir ${attachment.fileName}? Esta ação não pode ser desfeita.`,
              confirmLabel: 'Excluir',
              danger: true,
              onConfirm: () => remove.mutate(attachment.id),
            })
          }
        >
          <IconTrash size={14} />
        </ActionIcon>
      </Tooltip>
    );

  return (
    <Stack gap="sm">
      {attachments.length === 0 && (
        <Text size="sm" c="dimmed">
          Nenhum anexo.
        </Text>
      )}
      {images.length > 0 && (
        <Group gap="sm">
          {images.map((a) => (
            <Paper key={a.id} withBorder p={4} radius="sm">
              <Anchor href={docAttachmentUrl(a.id)} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ${a.fileName}`} title={a.fileName}>
                <Image src={docAttachmentUrl(a.id)} alt={a.fileName} w={120} h={90} fit="cover" radius="sm" />
              </Anchor>
              <Group gap={4} justify="space-between" wrap="nowrap" mt={4} maw={120}>
                <Text size="xs" truncate>
                  {a.fileName}
                </Text>
                {removeButton(a)}
              </Group>
            </Paper>
          ))}
        </Group>
      )}
      {files.map((a) => (
        <Group key={a.id} gap="xs" justify="space-between" wrap="nowrap">
          <Anchor href={docAttachmentUrl(a.id)} download={a.fileName} size="sm">
            <Group gap={4} wrap="nowrap" component="span">
              <IconFileDownload size={16} aria-hidden />
              <span>{a.fileName}</span>
              <Text span size="xs" c="dimmed">
                ({formatBytes(a.size)} · {formatDateTime(a.createdAt)})
              </Text>
            </Group>
          </Anchor>
          {removeButton(a)}
        </Group>
      ))}
      {canManage && (
        <Group className="no-print">
          <FileButton onChange={addFiles} multiple>
            {(props) => (
              <Tooltip label="Até 10 MB por arquivo">
                <Button {...props} variant="default" size="xs" leftSection={<IconPaperclip size={14} />} loading={upload.isPending}>
                  Anexar arquivos
                </Button>
              </Tooltip>
            )}
          </FileButton>
        </Group>
      )}
    </Stack>
  );
}
