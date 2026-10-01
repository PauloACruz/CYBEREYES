import { notifications } from '@mantine/notifications';
import { ApiError } from '../../api/client';

/** Mensagem do erro ao excluir pessoa (409 quando ainda tem ativos atribuidos). */
export function notifyPersonDeleteError(error: unknown): void {
  const message =
    error instanceof ApiError && error.status === 409
      ? 'Esta pessoa ainda é responsável por ativos. Desative o cadastro em vez de excluir.'
      : error instanceof ApiError
        ? error.title
        : 'Não foi possível excluir a pessoa.';
  notifications.show({ color: 'red', title: 'Excluir pessoa', message });
}
