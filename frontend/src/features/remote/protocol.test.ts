import { describe, expect, it } from 'vitest';
import { ackFrame, FRAME, jsonFrame, parseFrameEnd, parseTile, readJson } from './protocol';

describe('protocolo do relay', () => {
  it('le TILE e FRAME_END no layout do contrato', () => {
    const tile = new Uint8Array([FRAME.tile, 0, 0, 0, 7, 0, 64, 0, 128, 1, 0, 0, 64, 0xff, 0xd8]);
    expect(parseTile(tile)).toMatchObject({ frame: 7, x: 64, y: 128, w: 256, h: 64 });
    expect(Array.from(parseTile(tile).jpeg)).toEqual([0xff, 0xd8]);
    const end = new Uint8Array([FRAME.frameEnd, 0, 0, 0, 7, 0, 3, 7, 128, 4, 56]);
    expect(parseFrameEnd(end)).toEqual({ frame: 7, tiles: 3, width: 1920, height: 1080 });
  });

  it('monta ACK e quadros JSON', () => {
    expect(Array.from(ackFrame(256, 42))).toEqual([FRAME.ack, 0, 0, 1, 0, 0, 0, 0, 42]);
    const key = jsonFrame(FRAME.key, { code: 'KeyA', down: true });
    expect(key[0]).toBe(FRAME.key);
    expect((readJson(key) as { code: string }).code).toBe('KeyA');
  });
});
