import type { QueryClient } from '@tanstack/react-query';
import { projectsApi } from '../../api/projects';
import { queryKeys } from '../../api/queryKeys';

export const MAX_FILES = 10;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export function refreshProject(queryClient: QueryClient, id: number): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.project(id) });
  void queryClient.invalidateQueries({ queryKey: [...queryKeys.projects, 'list'] });
  void queryClient.invalidateQueries({ queryKey: [...queryKeys.projects, 'agent'] });
}

/** Envia os anexos de um registro, um por vez; devolve quantos falharam (o erro de cada um aparece na notificação global). */
export async function uploadAll(projectId: number, noteId: number, files: File[]): Promise<number> {
  let failed = 0;
  for (const file of files) {
    try {
      await projectsApi.upload(projectId, noteId, file);
    } catch {
      failed++;
    }
  }
  return failed;
}

export function tooLarge(files: File[]): string | null {
  if (files.length > MAX_FILES) return `No máximo ${MAX_FILES} arquivos por registro`;
  const big = files.find((f) => f.size > MAX_FILE_BYTES);
  return big ? `${big.name} passa de 10 MB` : null;
}
