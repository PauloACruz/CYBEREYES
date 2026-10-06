import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, mockFetch, problem } from '../../test/utils';
import { joinPath, UPLOAD_BLOCK, uploadFile } from './uploads';

const base = '/api/remote/sessions/s1';

describe('envio de arquivos em blocos', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('envia em blocos de 1 MiB com Content-Range e conclui', async () => {
    const ranges: string[] = [];
    mockFetch({
      [`POST ${base}/uploads`]: () => json({ transferId: 3, received: 0 }, 201),
      [`PUT ${base}/uploads/3`]: (init) => {
        const range = new Headers(init?.headers).get('Content-Range') ?? '';
        ranges.push(range);
        const end = Number(/-(\d+)\//.exec(range)?.[1]);
        return json({ received: end + 1 });
      },
      [`POST ${base}/uploads/3/complete`]: () => json({ transferId: 3, sha256: 'abc', path: 'C:\\Users\\maria\\Desktop\\a.bin' }),
    });
    const file = new Blob([new Uint8Array(UPLOAD_BLOCK * 2 + 10)]);
    const progress: number[] = [];
    const result = await uploadFile('s1', file, 'C:\\Users\\maria\\Desktop\\a.bin', { onProgress: (sent) => progress.push(sent) });
    expect(ranges).toEqual([`bytes 0-${UPLOAD_BLOCK - 1}/${file.size}`, `bytes ${UPLOAD_BLOCK}-${2 * UPLOAD_BLOCK - 1}/${file.size}`, `bytes ${2 * UPLOAD_BLOCK}-${file.size - 1}/${file.size}`]);
    expect(progress.at(-1)).toBe(file.size);
    expect(result.sha256).toBe('abc');
  });

  it('retoma depois de queda de rede a partir do que a estacao ja tem', async () => {
    let puts = 0;
    const begins: number[] = [];
    mockFetch({
      [`POST ${base}/uploads`]: () => {
        begins.push(1);
        return json({ transferId: 4, received: begins.length === 1 ? 0 : UPLOAD_BLOCK }, 201);
      },
      [`PUT ${base}/uploads/4`]: (init) => {
        puts++;
        if (puts === 2) throw new TypeError('rede caiu');
        const range = new Headers(init?.headers).get('Content-Range') ?? '';
        return json({ received: Number(/-(\d+)\//.exec(range)?.[1]) + 1 });
      },
      [`POST ${base}/uploads/4/complete`]: () => json({ transferId: 4, sha256: 'x', path: '/tmp/a' }),
    });
    const file = new Blob([new Uint8Array(UPLOAD_BLOCK * 2)]);
    await uploadFile('s1', file, '/tmp/a', { sleep: () => Promise.resolve() });
    expect(begins).toHaveLength(2);
    expect(puts).toBe(3);
  });

  it('repassa erros definitivos sem tentar de novo', async () => {
    mockFetch({
      [`POST ${base}/uploads`]: () => problem(409, 'FILE_EXISTS', 'O destino ja existe'),
    });
    await expect(uploadFile('s1', new Blob(['a']), '/tmp/a')).rejects.toMatchObject({ status: 409, code: 'FILE_EXISTS' });
  });

  it('junta caminhos com o separador da estacao', () => {
    expect(joinPath('C:\\Users\\maria\\Desktop', 'a.txt', '\\')).toBe('C:\\Users\\maria\\Desktop\\a.txt');
    expect(joinPath('/home/maria/', 'a.txt', '/')).toBe('/home/maria/a.txt');
  });
});
