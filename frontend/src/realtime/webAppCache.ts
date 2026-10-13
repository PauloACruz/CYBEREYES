import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '../api/queryKeys';

/** Evento webAppChanged (aplicacao caiu, voltou ou foi editada): recarrega a visao geral e os detalhes em tela. */
export function applyWebAppChanged(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.webApps });
}

/** Evento appRunsChanged (execucao iniciada ou concluida): recarrega historicos e o ultimo deploy da aplicacao. */
export function applyAppRunsChanged(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.appRunLists });
  void queryClient.invalidateQueries({ queryKey: queryKeys.webApps });
}
