import { useState } from 'react';
import { ActionIcon, Button, Checkbox, Group, Modal, Paper, SegmentedControl, Stack, Text, Textarea, Title, Tooltip } from '@mantine/core';
import { IconPencil } from '@tabler/icons-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import { ticketsApi } from '../../api/tickets';
import type { ResolveTicketRequest, TicketDetail, TicketResolutionKind } from '../../api/types';
import { formatDateTime } from '../../lib/format';
import { notifySuccess } from '../../lib/feedback';
import { RESOLUTION_KIND_LABEL } from './ticketFormat';
import { storeTicket } from './ticketActions';

const KIND_OPTIONS = (['solution', 'workaround'] as const).map((value) => ({ value, label: RESOLUTION_KIND_LABEL[value] }));

const KIND_HINT: Record<TicketResolutionKind, string> = {
  solution: 'O que resolveu o problema de vez.',
  workaround: 'Como contornar o problema enquanto a causa não é corrigida.',
};

const RESOLUTION_COLOR: Record<TicketResolutionKind, string> = {
  solution: 'teal',
  workaround: 'orange',
};

interface ResolveTicketModalProps {
  ticket: TicketDetail;
  opened: boolean;
  onClose: () => void;
}

export function ResolveTicketModal({ ticket, opened, onClose }: ResolveTicketModalProps) {
  const editing = ticket.status === 'resolved' && ticket.resolution !== null;
  return (
    <Modal opened={opened} onClose={onClose} title={editing ? 'Editar solução' : `Resolver chamado #${ticket.id}`} size="lg" centered>
      {opened && <ResolveForm ticket={ticket} editing={editing} onClose={onClose} />}
    </Modal>
  );
}

function ResolveForm({ ticket, editing, onClose }: { ticket: TicketDetail; editing: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<TicketResolutionKind>(ticket.resolutionKind ?? 'solution');
  const [text, setText] = useState(ticket.resolution ?? '');
  const [notify, setNotify] = useState(true);
  const resolve = useMutation({
    mutationFn: (body: ResolveTicketRequest) => ticketsApi.resolve(ticket.id, body),
    onSuccess: (updated) => {
      notifySuccess(editing ? 'Solução atualizada.' : 'Chamado resolvido.');
      storeTicket(queryClient, updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.ticketMessages(ticket.id) });
      onClose();
    },
  });

  const trimmed = text.trim();
  const tooLong = text.length > 20000;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (trimmed && !tooLong) resolve.mutate({ kind, resolution: trimmed, internal: !notify });
      }}
    >
      <Stack>
        <SegmentedControl
          aria-label="Tipo de solução"
          data={KIND_OPTIONS}
          value={kind}
          onChange={(v) => setKind(v === 'workaround' ? 'workaround' : 'solution')}
          color={RESOLUTION_COLOR[kind]}
          fullWidth
        />
        <Textarea
          label={RESOLUTION_KIND_LABEL[kind]}
          description={KIND_HINT[kind]}
          autosize
          minRows={4}
          maxRows={12}
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          error={tooLong ? 'Use no máximo 20000 caracteres' : undefined}
          required
          data-autofocus
        />
        <Checkbox
          label="Enviar ao usuário na conversa"
          description={notify ? 'O usuário vê o texto no app de bandeja.' : 'O texto fica como nota interna, só para os técnicos.'}
          checked={notify}
          onChange={(e) => setNotify(e.currentTarget.checked)}
        />
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" color="teal" loading={resolve.isPending} disabled={!trimmed || tooLong}>
            {editing ? 'Salvar solução' : 'Resolver'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

/** Solucao registrada pelo botao Resolver; pode ser corrigida enquanto o chamado estiver resolvido. */
export function ResolutionCard({ ticket, canManage }: { ticket: TicketDetail; canManage: boolean }) {
  const [editing, setEditing] = useState(false);
  if (!ticket.resolutionKind || ticket.resolution === null) return null;
  const label = RESOLUTION_KIND_LABEL[ticket.resolutionKind];
  return (
    <Paper
      withBorder
      p="md"
      component="section"
      aria-labelledby="solucao-title"
      style={{ borderLeft: `4px solid var(--mantine-color-${RESOLUTION_COLOR[ticket.resolutionKind]}-6)` }}
    >
      <Group justify="space-between" mb="xs" wrap="nowrap">
        <Title order={4} id="solucao-title">
          {label}
        </Title>
        {canManage && ticket.status === 'resolved' && (
          <Tooltip label="Editar solução">
            <ActionIcon variant="subtle" color="gray" aria-label="Editar solução" onClick={() => setEditing(true)}>
              <IconPencil size={16} />
            </ActionIcon>
          </Tooltip>
        )}
      </Group>
      <Text size="sm" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {ticket.resolution}
      </Text>
      <ResolutionByline ticket={ticket} />
      <ResolveTicketModal ticket={ticket} opened={editing} onClose={() => setEditing(false)} />
    </Paper>
  );
}

export function ResolutionByline({ ticket }: { ticket: TicketDetail }) {
  if (!ticket.resolvedByName && !ticket.resolvedAt) return null;
  return (
    <Text size="xs" c="dimmed" mt="xs">
      {ticket.resolvedByName ? `Por ${ticket.resolvedByName}` : 'Resolvido'}
      {ticket.resolvedAt ? ` em ${formatDateTime(ticket.resolvedAt)}` : ''}
    </Text>
  );
}
