export const MSG_INIT_STATE = 0x00;
export const MSG_SYNC_STATE = 0x01;

type IncomingMessage =
  | { type: typeof MSG_INIT_STATE; tick: number; snapshot: ArrayBuffer }
  | { type: typeof MSG_SYNC_STATE; tick: number; data: ArrayBuffer; struct: ArrayBuffer };

export function decodeMessage(raw: ArrayBuffer): IncomingMessage {
  const type = new DataView(raw, 0, 1).getUint8(0);
  if (type === MSG_INIT_STATE) return { type, ...decodeInitState(raw) };
  if (type === MSG_SYNC_STATE) return { type, ...decodeSyncState(raw) };
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

export function encodeSyncState(tick: number, data: ArrayBuffer, struct: ArrayBuffer): ArrayBuffer {
  const buf = new ArrayBuffer(1 + 4 + 4 + data.byteLength + 4 + struct.byteLength);
  const v = new DataView(buf);
  let offset = 0;
  v.setUint8(offset, MSG_SYNC_STATE);
  offset += 1;
  v.setUint32(offset, tick);
  offset += 4;
  v.setUint32(offset, data.byteLength);
  offset += 4;
  new Uint8Array(buf, offset, data.byteLength).set(new Uint8Array(data));
  offset += data.byteLength;
  v.setUint32(offset, struct.byteLength);
  offset += 4;
  new Uint8Array(buf, offset, struct.byteLength).set(new Uint8Array(struct));
  return buf;
}

export function decodeSyncState(raw: ArrayBuffer): { tick: number; data: ArrayBuffer; struct: ArrayBuffer } {
  const view = new DataView(raw);
  let offset = 1;
  const tick = view.getUint32(offset);
  offset += 4;
  const dataLen = view.getUint32(offset);
  offset += 4;
  const data = raw.slice(offset, offset + dataLen);
  offset += dataLen;
  const structLen = view.getUint32(offset);
  offset += 4;
  const struct = raw.slice(offset, offset + structLen);
  return { tick, data, struct };
}
