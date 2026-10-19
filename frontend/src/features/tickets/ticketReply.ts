import { useEffect, useState } from 'react';
import { notifications } from '@mantine/notifications';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import { ticketsApi } from '../../api/tickets';
import type { TicketMessageDto } from '../../api/types';
import { useConsoleHubConnection } from '../../realtime/consoleHubContext';
import { appendTicketMessage } from '../../realtime/ticketCache';
import { MAX_ATTACHMENT_BYTES, refreshTicketDetail } from './ticketActions';

export type ReplyMode = 'public' | 'internal';

export const REPLY_OPTIONS: { value: ReplyMode; label: string }[] = [
  { value: 'public', label: 'Resposta ao usuário' },
  { value: 'internal', label: 'Nota interna' },
];

/** Entra no grupo do chamado no hub e acrescenta as mensagens recebidas em tempo real. */
export function useTicketRealtime(ticketId: number) {
  const queryClient = useQueryClient();
  const { connection, connected } = useConsoleHubConnection();

  useEffect(() => {
    if (!connection) return;
    const onMessage = (eventTicketId: number, message: TicketMessageDto) => {
      if (eventTicketId === ticketId) appendTicketMessage(queryClient, ticketId, message);
    };
    connection.on('ticketMessage', onMessage);
    return () => connection.off('ticketMessage', onMessage);
  }, [connection, ticketId, queryClient]);

  useEffect(() => {
    if (!connection || !connected) return;
    connection.invoke('JoinTicket', ticketId).catch(() => undefined);
    return () => {
      connection.invoke('LeaveTicket', ticketId).catch(() => undefined);
    };
  }, [connection, connected, ticketId]);
}

/** Estado e envio de uma resposta (texto e anexos): usado no console e no app do tecnico. Em incidente interno, so nota interna. */
export function useTicketReply(ticketId: number, internalOnly = false) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<ReplyMode>('public');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const internal = internalOnly || mode === 'internal';

  const send = useMutation({
    mutationFn: async () => {
      const text = body.trim();
      let message: TicketMessageDto | undefined;
      if (text) {
        message = await ticketsApi.sendMessage(ticketId, { body: text, internal });
        appendTicketMessage(queryClient, ticketId, message);
      }
      for (const file of files) {
        await ticketsApi.upload(ticketId, file, message ? { messageId: message.id } : { internal });
      }
      return { message, uploaded: files.length };
    },
    onSuccess: ({ uploaded }) => {
      setBody('');
      setFiles([]);
      if (uploaded > 0) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.ticketMessages(ticketId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.ticketAttachments(ticketId) });
      }
      refreshTicketDetail(queryClient, ticketId);
    },
    onError: () => {
      // Mensagem ja gravada antes de um anexo falhar: recarregar para refletir o estado real.
      void queryClient.invalidateQueries({ queryKey: queryKeys.ticketMessages(ticketId) });
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
    if (accepted.length > 0) setFiles((prev) => [...prev, ...accepted]);
  };
  const removeFile = (index: number) => setFiles((prev) => prev.filter((_, i) => i !== index));

  const tooLong = body.length > 20000;
  const canSend = (body.trim().length > 0 || files.length > 0) && !tooLong;
  return { mode, setMode, body, setBody, files, addFiles, removeFile, internal, send, tooLong, canSend };
}

