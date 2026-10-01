import { Anchor, Group, Image, Stack, Text } from '@mantine/core';
import { IconFileDownload } from '@tabler/icons-react';
import { ticketAttachmentUrl } from '../../api/tickets';
import type { TicketAttachmentDto } from '../../api/types';
import { formatBytes } from '../../lib/format';
import { isInlineImage } from './ticketActions';

export function AttachmentLink({ ticketId, attachment }: { ticketId: number; attachment: TicketAttachmentDto }) {
  const url = ticketAttachmentUrl(ticketId, attachment.id);
  if (isInlineImage(attachment.contentType)) {
    return (
      <Anchor href={url} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ${attachment.fileName}`} title={attachment.fileName}>
        <Image src={url} alt={attachment.fileName} w={120} h={90} fit="cover" radius="sm" />
      </Anchor>
    );
  }
  return (
    <Anchor href={url} download={attachment.fileName} size="sm">
      <Group gap={4} wrap="nowrap" component="span">
        <IconFileDownload size={16} aria-hidden />
        <span>{attachment.fileName}</span>
        <Text span size="xs" c="dimmed">
          ({formatBytes(attachment.size)})
        </Text>
      </Group>
    </Anchor>
  );
}

export function AttachmentList({ ticketId, attachments }: { ticketId: number; attachments: TicketAttachmentDto[] }) {
  if (attachments.length === 0) return null;
  const images = attachments.filter((a) => isInlineImage(a.contentType));
  const files = attachments.filter((a) => !isInlineImage(a.contentType));
  return (
    <Stack gap={6}>
      {images.length > 0 && (
        <Group gap="xs">
          {images.map((a) => (
            <AttachmentLink key={a.id} ticketId={ticketId} attachment={a} />
          ))}
        </Group>
      )}
      {files.map((a) => (
        <AttachmentLink key={a.id} ticketId={ticketId} attachment={a} />
      ))}
    </Stack>
  );
}
