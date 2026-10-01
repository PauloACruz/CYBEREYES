import { Alert } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { ApiError, errorDetail } from '../api/client';

/** Erro de uma acao exibido no proprio painel (requisicoes feitas com silent). */
export function ApiErrorAlert({ error }: { error: unknown }) {
  const apiError = error instanceof ApiError ? error : null;
  return (
    <Alert color="red" icon={<IconAlertCircle size={18} />} title={apiError?.title ?? 'Não foi possível concluir a ação'}>
      {apiError ? errorDetail(apiError) : 'Tente novamente em instantes.'}
    </Alert>
  );
}
