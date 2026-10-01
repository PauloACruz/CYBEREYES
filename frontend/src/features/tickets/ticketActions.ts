import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import type { TicketDetail } from '../../api/types';

/** Grava o detalhe devolvido por uma escrita e marca listas e contadores para recarregar. */
export function storeTicket(queryClient: QueryClient, ticket: TicketDetail): void {
  queryClient.setQueryData(queryKeys.ticketDetail(ticket.id), ticket);
  void queryClient.invalidateQueries({ queryKey: queryKeys.ticketLists });
  void queryClient.invalidateQueries({ queryKey: queryKeys.ticketSummary });
  void queryClient.invalidateQueries({ queryKey: queryKeys.agentTicketLists });
}

/** Recarrega somente o detalhe (sem mensagens, anexos e apontamentos). */
export function refreshTicketDetail(queryClient: QueryClient, id: number): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.ticketDetail(id), exact: true });
}

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const INLINE_IMAGES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** Imagens que o servidor entrega com Content-Disposition inline (podem virar miniatura). */
export function isInlineImage(contentType: string): boolean {
  return INLINE_IMAGES.has(contentType.toLowerCase());
}
