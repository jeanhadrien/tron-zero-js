import type { NetworkDiffPayload } from './interfaces/Network';

export const MSG_INIT_STATE = 0x00;
export const MSG_SYNC_STATE_BATCH = 0x01;

/** Number of recent per-tick diffs the server keeps in its history ring buffer and sends as a contiguous window. */
export const SERVER_DIFF_HISTORY_SIZE = 10;

type IncomingMessage =
  | { type: typeof MSG_INIT_STATE; tick: number; snapshot: ArrayBuffer }
  | { type: typeof MSG_SYNC_STATE_BATCH; serverTick: number; diffs: NetworkDiffPayload[] };

export function decodeMessage(raw: ArrayBuffer): IncomingMessage {
  const type = new DataView(raw, 0, 1).getUint8(0);
  if (type === MSG_INIT_STATE) return { type, ...decodeInitState(raw) };
  if (type === MSG_SYNC_STATE_BATCH) return { type, ...decodeSyncStateBatch(raw) };
  throw new Error(`Unknown message type: 0x${type.toString(16).padStart(2, '0')}`);
}

export function encodeInitState(tick: number, snapshot: ArrayBuffer): ArrayBuffer {
  const buf = new ArrayBuffer(1 + 4 + snapshot.byteLength);
  const v = new DataView(buf);
  v.setUint8(0, MSG_INIT_STATE);
  v.setUint32(1, tick);
  new Uint8Array(buf, 5).set(new Uint8Array(snapshot));
  return buf;
}

export function decodeInitState(raw: ArrayBuffer): { tick: number; snapshot: ArrayBuffer } {
  const tick = new DataView(raw, 1, 4).getUint32(0);
  const snapshot = raw.slice(5);
  return { tick, snapshot };
}

/**
 * Encode a batch of per-tick authoritative diffs into a single packet.
 * Wire format: [0x01 | serverTick(u32) | diffCount(u32) | diff₁ ... diffₙ]
 * Each diff:   tick(u32) | dataLen(u32) | data | structLen(u32) | struct
 */
export function encodeSyncStateBatch(serverTick: number, diffs: NetworkDiffPayload[]): ArrayBuffer {
  let totalSize = 1 + 4 + 4; // type + serverTick + diffCount
  for (const d of diffs) {
    totalSize += 4 + 4 + d.data.byteLength + 4 + d.struct.byteLength;
  }
  const buf = new ArrayBuffer(totalSize);
  const v = new DataView(buf);
  let offset = 0;
  v.setUint8(offset, MSG_SYNC_STATE_BATCH);
  offset += 1;
  v.setUint32(offset, serverTick);
  offset += 4;
  v.setUint32(offset, diffs.length);
  offset += 4;
  for (const d of diffs) {
    v.setUint32(offset, d.tick);
    offset += 4;
    v.setUint32(offset, d.data.byteLength);
    offset += 4;
    new Uint8Array(buf, offset, d.data.byteLength).set(new Uint8Array(d.data));
    offset += d.data.byteLength;
    v.setUint32(offset, d.struct.byteLength);
    offset += 4;
    new Uint8Array(buf, offset, d.struct.byteLength).set(new Uint8Array(d.struct));
    offset += d.struct.byteLength;
  }
  return buf;
}

export function decodeSyncStateBatch(raw: ArrayBuffer): { serverTick: number; diffs: NetworkDiffPayload[] } {
  const view = new DataView(raw);
  let offset = 1;
  const serverTick = view.getUint32(offset);
  offset += 4;
  const diffCount = view.getUint32(offset);
  offset += 4;
  const diffs: NetworkDiffPayload[] = [];
  for (let i = 0; i < diffCount; i++) {
    const tick = view.getUint32(offset);
    offset += 4;
    const dataLen = view.getUint32(offset);
    offset += 4;
    const data = raw.slice(offset, offset + dataLen);
    offset += dataLen;
    const structLen = view.getUint32(offset);
    offset += 4;
    const struct = raw.slice(offset, offset + structLen);
    offset += structLen;
    diffs.push({ tick, data, struct });
  }
  return { serverTick, diffs };
}
