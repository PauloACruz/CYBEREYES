import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '../api/queryKeys';
import type { TicketMessageDto, TicketsChangedEvent } from '../api/types';

/** Evento ticketsChanged: recarrega listas, contadores e o detalhe do chamado alterado (se estiver em cache). */
export function applyTicketsChanged(queryClient: QueryClient, event: TicketsChangedEvent): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.ticketLists });
  void queryClient.invalidateQueries({ queryKey: queryKeys.ticketSummary });
  void queryClient.invalidateQueries({ queryKey: queryKeys.agentTicketLists });
  void queryClient.invalidateQueries({ queryKey: queryKeys.ticketDetail(event.ticketId) });
}

/** Acrescenta uma mensagem a conversa em cache, sem duplicar quando ela ja chegou pela API ou pelo hub. */
export function appendTicketMessage(queryClient: QueryClient, ticketId: number, message: TicketMessageDto): void {
  queryClient.setQueryData<TicketMessageDto[]>(queryKeys.ticketMessages(ticketId), (old) => {
    if (!old) return old;
    if (old.some((m) => m.id === message.id)) return old;
    return [...old, message];
  });
}
