import { useCallback, useState } from 'react';
import { ApiError } from '../../api/client';
import { joinPath, uploadFile, type UploadResult } from './uploads';

export interface Transfer {
  id: string;
  name: string;
  sent: number;
  total: number;
  status: 'waiting' | 'running' | 'done' | 'failed';
  error?: string;
}

function failureText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'FILE_EXISTS') return 'Já existe um arquivo com esse nome no destino.';
    if (error.code === 'FILE_TOO_LARGE') return 'Arquivo acima do limite permitido.';
    if (error.code === 'INVALID_PATH') return 'Nome ou pasta inválidos na máquina remota.';
    if (error.status === 403) return 'A política não permite enviar arquivos.';
    return error.title;
  }
  return error instanceof Error ? error.message : 'Falha no envio.';
}

let seq = 0;

/** Fila de envios da sessao: um arquivo por vez, com progresso. */
export function useTransfers(sessionId: string | null) {
  const [transfers, setTransfers] = useState<Transfer[]>([]);

  const update = useCallback((id: string, patch: Partial<Transfer>) => {
    setTransfers((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  /** Envia os arquivos para a pasta e devolve os que chegaram. */
  const upload = useCallback(
    async (files: File[], dir: string, separator: string): Promise<UploadResult[]> => {
      if (!sessionId || files.length === 0) return [];
      const items = files.map((f) => ({ file: f, entry: { id: `t${String(++seq)}`, name: f.name, sent: 0, total: f.size, status: 'waiting' as const } }));
      setTransfers((list) => [...items.map((i) => i.entry), ...list].slice(0, 50));
      const done: UploadResult[] = [];
      for (const { file, entry } of items) {
        update(entry.id, { status: 'running' });
        try {
          const result = await uploadFile(sessionId, file, joinPath(dir, file.name, separator), {
            onProgress: (sent, total) => update(entry.id, { sent, total }),
          });
          done.push(result);
          update(entry.id, { status: 'done', sent: file.size });
        } catch (error) {
          update(entry.id, { status: 'failed', error: failureText(error) });
        }
      }
      return done;
    },
    [sessionId, update],
  );

  const clear = useCallback(() => setTransfers((list) => list.filter((t) => t.status === 'running' || t.status === 'waiting')), []);

  return { transfers, upload, clear };
}
