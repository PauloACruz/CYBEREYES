import { ApiError } from '../../api/client';
import { remoteFilesApi } from '../../api/remote';

/** Tamanho de cada PUT (contrato, secao 7.4). */
export const UPLOAD_BLOCK = 1 << 20;
const MAX_RETRIES = 5;

export interface UploadResult {
  transferId: number;
  sha256: string;
  path: string;
}

export interface UploadOptions {
  overwrite?: boolean;
  onProgress?: (sent: number, total: number) => void;
  signal?: AbortSignal;
  /** Espera entre tentativas (trocada nos testes). */
  sleep?: (ms: number) => Promise<void>;
}

/** Junta pasta e nome com o separador da estacao. */
export function joinPath(dir: string, name: string, separator: string): string {
  return dir.endsWith(separator) ? dir + name : dir + separator + name;
}

/** Pastas do caminho para a navegacao (Windows "C:\\a\\b" ou Unix "/a/b"). */
export function pathCrumbs(path: string, separator: string): { label: string; path: string }[] {
  if (separator === '\\') {
    const parts = path.split('\\').filter(Boolean);
    return parts.map((label, i) => ({ label, path: i === 0 ? `${label}\\` : parts.slice(0, i + 1).join('\\') }));
  }
  const parts = path.split('/').filter(Boolean);
  return [{ label: '/', path: '/' }, ...parts.map((label, i) => ({ label, path: '/' + parts.slice(0, i + 1).join('/') }))];
}

export function parentPath(path: string, separator: string): string | null {
  const crumbs = pathCrumbs(path, separator);
  return crumbs.length > 1 ? (crumbs[crumbs.length - 2]?.path ?? null) : null;
}

function receivedFrom(error: unknown): number | null {
  if (error instanceof ApiError && error.status === 416) {
    const received = (error.problem as { received?: unknown }).received;
    return typeof received === 'number' ? received : null;
  }
  return null;
}

function retryable(error: unknown): boolean {
  // Queda de rede (status 0), servidor reiniciando ou agente lento: tenta de novo e retoma.
  return error instanceof ApiError && (error.status === 0 || error.status === 502 || error.status === 503 || error.status === 504);
}

/**
 * Envia um arquivo em blocos de 1 MiB a partir do que a estacao ja tem. Queda no meio: pede de novo a transferencia
 * (mesmo destino e tamanho) e continua de onde parou.
 */
export async function uploadFile(sessionId: string, file: Blob, path: string, options: UploadOptions = {}): Promise<UploadResult> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const total = file.size;
  let { transferId, received } = await remoteFilesApi.beginUpload(sessionId, path, total, options.overwrite ?? false);
  options.onProgress?.(received, total);
  let failures = 0;
  while (received < total) {
    options.signal?.throwIfAborted();
    const chunk = file.slice(received, Math.min(received + UPLOAD_BLOCK, total));
    try {
      received = (await remoteFilesApi.putChunk(sessionId, transferId, chunk, received, total, options.signal)).received;
      failures = 0;
      options.onProgress?.(received, total);
    } catch (error) {
      const resumeAt = receivedFrom(error);
      if (resumeAt !== null) {
        received = resumeAt;
        continue;
      }
      if (!retryable(error) || ++failures > MAX_RETRIES) throw error;
      await sleep(Math.min(16_000, 1000 * 2 ** (failures - 1)));
      ({ transferId, received } = await remoteFilesApi.beginUpload(sessionId, path, total, options.overwrite ?? false));
    }
  }
  return remoteFilesApi.completeUpload(sessionId, transferId);
}
