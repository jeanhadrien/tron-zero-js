/**
 * Patched no-copy serializers — based on bitecs but returns Uint8Array views
 * instead of ArrayBuffer slices to eliminate per-snapshot GC pressure.
 */

import {
  addComponent,
  hasComponent,
  getAllEntities,
  addEntity,
  isRelation,
  getRelationTargets,
  World,
} from 'bitecs';
import {
  $u8,
  $i8,
  $u16,
  $i16,
  $u32,
  $i32,
  $f32,
  $f64,
  $str,
  $ref,
} from 'bitecs/serialization';

// ── type helpers ────────────────────────────────────────────────────────────

type BitecsSoAComponent =
  | Int8Array | Uint8Array | Int16Array | Uint16Array
  | Int32Array | Uint32Array | Float32Array | Float64Array
  | (ArrayLike<number> & Record<symbol, unknown>);

const $arr = Symbol.for('bitecs-arr');

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function isArrayType(value: unknown): value is unknown[] {
  return Array.isArray(value) && ($arr as symbol) in (value as any);
}

function getArrayElementType(arrayType: unknown[]): unknown {
  return (arrayType as any)[$arr];
}

function isTypedArrayOrBranded(arr: unknown): arr is BitecsSoAComponent {
  return !!(arr && (ArrayBuffer.isView(arr) || (Array.isArray(arr) && typeof arr === 'object')));
}

function resolveTypeToSymbol(type: unknown): symbol {
  if (typeof type === 'symbol') return type;
  if (isArrayType(type as unknown[])) return resolveTypeToSymbol(getArrayElementType(type as unknown[]));
  const arr = type as any;
  if (arr) {
    for (const sym of [$u8, $i8, $u16, $i16, $u32, $i32, $f32, $f64, $str, $ref]) {
      if (sym in arr) return sym;
    }
  }
  if (type instanceof Int8Array) return $i8;
  if (type instanceof Uint8Array) return $u8;
  if (type instanceof Int16Array) return $i16;
  if (type instanceof Uint16Array) return $u16;
  if (type instanceof Int32Array) return $i32;
  if (type instanceof Uint32Array) return $u32;
  if (type instanceof Float32Array) return $f32;
  return $f64;
}

function getTypeForArray(arr: unknown): symbol {
  if (isArrayType(arr as unknown[])) return resolveTypeToSymbol((arr as any)[$arr]);
  for (const sym of [$u8, $i8, $u16, $i16, $u32, $i32, $f32, $f64, $str, $ref]) {
    if (sym in (arr as any)) return sym;
  }
  if (arr instanceof Int8Array) return $i8;
  if (arr instanceof Uint8Array) return $u8;
  if (arr instanceof Int16Array) return $i16;
  if (arr instanceof Uint16Array) return $u16;
  if (arr instanceof Int32Array) return $i32;
  if (arr instanceof Uint32Array) return $u32;
  if (arr instanceof Float32Array) return $f32;
  return $f64;
}

// ── binary helpers ──────────────────────────────────────────────────────────

type Setter = (view: DataView, offset: number, value: number) => number;

const typeSetters: Record<symbol, Setter> = {
  [$u8]: (v, o, val) => (v.setUint8(o, val), 1),
  [$i8]: (v, o, val) => (v.setInt8(o, val), 1),
  [$u16]: (v, o, val) => (v.setUint16(o, val), 2),
  [$i16]: (v, o, val) => (v.setInt16(o, val), 2),
  [$u32]: (v, o, val) => (v.setUint32(o, val), 4),
  [$i32]: (v, o, val) => (v.setInt32(o, val), 4),
  [$f32]: (v, o, val) => (v.setFloat32(o, val), 4),
  [$f64]: (v, o, val) => (v.setFloat64(o, val), 8),
  [$ref]: (v, o, val) => (v.setUint32(o, val), 4),
  [$str]: (v, o, val) => {
    const enc = textEncoder.encode(String(val));
    let w = 0;
    w += typeSetters[$u32](v, o + w, enc.length);
    new Uint8Array(v.buffer, v.byteOffset + o + w, enc.length).set(enc);
    w += enc.length;
    return w;
  },
};

type GetterResult = { value: number; size: number };

const typeGetters: Record<symbol, (view: DataView, offset: number) => GetterResult> = {
  [$u8]: (v, o) => ({ value: v.getUint8(o), size: 1 }),
  [$i8]: (v, o) => ({ value: v.getInt8(o), size: 1 }),
  [$u16]: (v, o) => ({ value: v.getUint16(o), size: 2 }),
  [$i16]: (v, o) => ({ value: v.getInt16(o), size: 2 }),
  [$u32]: (v, o) => ({ value: v.getUint32(o), size: 4 }),
  [$i32]: (v, o) => ({ value: v.getInt32(o), size: 4 }),
  [$f32]: (v, o) => ({ value: v.getFloat32(o), size: 4 }),
  [$f64]: (v, o) => ({ value: v.getFloat64(o), size: 8 }),
  [$ref]: (v, o) => ({ value: v.getUint32(o), size: 4 }),
  [$str]: (v, o) => {
    const { value: len, size: s } = typeGetters[$u32](v, o);
    const bytes = new Uint8Array(v.buffer, v.byteOffset + o + s, len);
    return { value: textDecoder.decode(bytes) as unknown as number, size: s + len };
  },
};

// ── array helpers ───────────────────────────────────────────────────────────

function serializeArrayValue(
  elementType: unknown,
  value: unknown,
  view: DataView,
  offset: number,
): number {
  let bytesWritten = 0;
  const isArrayDefined = Array.isArray(value) ? 1 : 0;
  bytesWritten += typeSetters[$u8](view, offset, isArrayDefined);
  if (!isArrayDefined) return bytesWritten;

  const v = value as unknown[];
  bytesWritten += typeSetters[$u32](view, offset + bytesWritten, v.length);
  for (let i = 0; i < v.length; i++) {
    if (isArrayType(elementType as unknown[])) {
      bytesWritten += serializeArrayValue(
        getArrayElementType(elementType as unknown[]),
        v[i],
        view,
        offset + bytesWritten,
      );
    } else {
      const sym = resolveTypeToSymbol(elementType);
      bytesWritten += typeSetters[sym](view, offset + bytesWritten, v[i] as number);
    }
  }
  return bytesWritten;
}

function deserializeArrayValue(
  elementType: unknown,
  view: DataView,
  offset: number,
  entityIdMapping?: Map<number, number>,
): { value?: unknown[]; size: number } {
  let bytesRead = 0;
  const isResult = typeGetters[$u8](view, offset + bytesRead);
  bytesRead += isResult.size;
  if (!isResult.value) return { size: bytesRead };

  const lenResult = typeGetters[$u32](view, offset + bytesRead);
  bytesRead += lenResult.size;
  const arr = new Array<unknown>(lenResult.value);
  for (let i = 0; i < arr.length; i++) {
    if (isArrayType(elementType as unknown[])) {
      const { value, size } = deserializeArrayValue(
        getArrayElementType(elementType as unknown[]),
        view,
        offset + bytesRead,
        entityIdMapping,
      );
      bytesRead += size;
      if (Array.isArray(value)) arr[i] = value;
    } else {
      const sym = resolveTypeToSymbol(elementType);
      const { value, size } = typeGetters[sym](view, offset + bytesRead);
      bytesRead += size;
      if (sym === $ref && entityIdMapping) {
        arr[i] = entityIdMapping.get(value) ?? value;
      } else {
        arr[i] = value;
      }
    }
  }
  return { value: arr, size: bytesRead };
}

// ── diff helpers ────────────────────────────────────────────────────────────

const isFloatType = (arr: unknown): boolean => {
  const t = getTypeForArray(arr);
  return t === $f32 || t === $f64;
};

const getEpsilonForType = (arr: unknown, epsilon: number): number =>
  isFloatType(arr) ? epsilon : 0;

const getShadow = (shadowMap: Map<unknown, unknown[]>, arr: unknown): unknown[] => {
  const existing = shadowMap.get(arr);
  if (existing) return existing;
  // Re-create a same-shaped array (typed if the component uses a TypedArray)
  const shadow: unknown[] = (ArrayBuffer.isView(arr) && !(arr instanceof DataView))
    ? new ((arr as any).constructor as any)((arr as any).length)
    : new Array((arr as any).length ?? 0).fill(0);
  shadowMap.set(arr, shadow);
  return shadow;
};

const hasChanged = (
  shadowMap: Map<unknown, unknown[]>,
  arr: unknown,
  index: number,
  epsilon = 1e-4,
): boolean => {
  const shadow = getShadow(shadowMap, arr);
  const currentValue = (arr as Record<number, number>)[index];
  const actualEpsilon = getEpsilonForType(arr, epsilon);
  const changed = actualEpsilon > 0
    ? Math.abs((shadow[index] as number) - currentValue) > actualEpsilon
    : shadow[index] !== currentValue;
  shadow[index] = currentValue;
  return changed;
};

// ── component serializer ────────────────────────────────────────────────────

type ComponentSerializer = (view: DataView, offset: number, index: number, componentId?: number) => number;
type ComponentDeserializer = (view: DataView, offset: number, entityIdMapping?: Map<number, number>) => number;

function createComponentSerializer(
  component: object,
  diff = false,
  shadowMap?: Map<unknown, unknown[]>,
  epsilon = 1e-4,
): ComponentSerializer {
  if (isTypedArrayOrBranded(component)) {
    const type = getTypeForArray(component);
    const setter = typeSetters[type];
    return (view, offset, index, componentId) => {
      if (diff && shadowMap) {
        if (!hasChanged(shadowMap, component, index, epsilon)) return 0;
        let bw = 0;
        bw += typeSetters[$u32](view, offset + bw, index);
        bw += typeSetters[$u32](view, offset + bw, componentId!);
        bw += setter(view, offset + bw, (component as Record<number, number>)[index]);
        return bw;
      }
      let bw = 0;
      bw += typeSetters[$u32](view, offset + bw, index);
      bw += setter(view, offset + bw, (component as Record<number, number>)[index]);
      return bw;
    };
  }

  // Object component
  const props = Object.keys(component);
  const types = props.map((p) => getTypeForArray((component as Record<string, unknown>)[p]));
  const setters = types.map((t) => typeSetters[t]);

  return (view, offset, index, componentId) => {
    const comp = component as Record<string, Record<number, number>>;
    if (diff && shadowMap) {
      let changeMask = 0;
      for (let i = 0; i < props.length; i++) {
        if (hasChanged(shadowMap, comp[props[i]], index, epsilon)) {
          changeMask |= 1 << i;
        }
      }
      if (changeMask === 0) return 0;
      let bw = 0;
      bw += typeSetters[$u32](view, offset + bw, index);
      bw += typeSetters[$u32](view, offset + bw, componentId!);
      const maskSetter = props.length <= 8 ? typeSetters[$u8] : props.length <= 16 ? typeSetters[$u16] : typeSetters[$u32];
      bw += maskSetter(view, offset + bw, changeMask);
      for (let i = 0; i < props.length; i++) {
        if (changeMask & (1 << i)) {
          const cp = comp[props[i]];
          if (isArrayType(cp as unknown)) {
            bw += serializeArrayValue(getArrayElementType(cp as unknown[]), cp[index], view, offset + bw);
          } else {
            bw += setters[i](view, offset + bw, cp[index]);
          }
        }
      }
      return bw;
    }

    // non-diff
    let bw = 0;
    bw += typeSetters[$u32](view, offset + bw, index);
    for (let i = 0; i < props.length; i++) {
      const cp = comp[props[i]];
      if (isArrayType(cp as unknown)) {
        bw += serializeArrayValue(getArrayElementType(cp as unknown[]), cp[index], view, offset + bw);
      } else {
        bw += setters[i](view, offset + bw, cp[index]);
      }
    }
    return bw;
  };
}

function createComponentDeserializer(
  component: object,
  diff = false,
): ComponentDeserializer {
  if (isTypedArrayOrBranded(component)) {
    const type = getTypeForArray(component);
    const getter = typeGetters[type];
    return (view, offset, entityIdMapping) => {
      let br = 0;
      const { value: origIdx, size: idxSize } = typeGetters[$u32](view, offset);
      br += idxSize;
      const index = entityIdMapping ? (entityIdMapping.get(origIdx) ?? origIdx) : origIdx;
      if (diff) {
        const { size: cidSize } = typeGetters[$u32](view, offset + br);
        br += cidSize;
      }
      const { value, size } = getter(view, offset + br);
      if (type === $ref && entityIdMapping) {
        (component as Record<number, number>)[index] = entityIdMapping.get(value) ?? value;
      } else {
        (component as Record<number, number>)[index] = value;
      }
      return br + size;
    };
  }

  const props = Object.keys(component);
  const types = props.map((p) => getTypeForArray((component as Record<string, unknown>)[p]));
  const getters = types.map((t) => typeGetters[t]);

  return (view, offset, entityIdMapping) => {
    const comp = component as Record<string, Record<number, number>>;
    let br = 0;
    const { value: origIdx, size: idxSize } = typeGetters[$u32](view, offset + br);
    br += idxSize;
    const index = entityIdMapping ? (entityIdMapping.get(origIdx) ?? origIdx) : origIdx;

    if (diff) {
      const { size: cidSize } = typeGetters[$u32](view, offset + br);
      br += cidSize;
      const maskGetter = props.length <= 8 ? typeGetters[$u8] : props.length <= 16 ? typeGetters[$u16] : typeGetters[$u32];
      const { value: mask, size: maskSize } = maskGetter(view, offset + br);
      br += maskSize;
      for (let i = 0; i < props.length; i++) {
        if (mask & (1 << i)) {
          const cp = comp[props[i]];
          if (isArrayType(cp as unknown)) {
            const { value, size } = deserializeArrayValue(getArrayElementType(cp as unknown[]), view, offset + br, entityIdMapping);
            if (Array.isArray(value)) (cp as any)[index] = value;
            br += size;
          } else {
            const { value, size } = getters[i](view, offset + br);
            if (types[i] === $ref && entityIdMapping) {
              cp[index] = entityIdMapping.get(value) ?? value;
            } else {
              cp[index] = value;
            }
            br += size;
          }
        }
      }
    } else {
      for (let i = 0; i < props.length; i++) {
        const cp = comp[props[i]];
        if (isArrayType(cp as unknown)) {
          const { value, size } = deserializeArrayValue(getArrayElementType(cp as unknown[]), view, offset + br, entityIdMapping);
          if (Array.isArray(value)) (cp as any)[index] = value;
          br += size;
        } else {
          const { value, size } = getters[i](view, offset + br);
          if (types[i] === $ref && entityIdMapping) {
            cp[index] = entityIdMapping.get(value) ?? value;
          } else {
            cp[index] = value;
          }
          br += size;
        }
      }
    }
    return br;
  };
}

// ── SoA serializer (patched: returns Uint8Array view, accepts baseOffset) ────

export interface SoASerializerOptions {
  diff?: boolean;
  buffer?: ArrayBuffer;
  epsilon?: number;
  /** Write data starting at this byte offset into the buffer (used for sub-region writes). */
  byteOffset?: number;
}

export function createSoASerializerNoCopy(
  components: object[],
  options: SoASerializerOptions = {},
): (indices: number[] | readonly number[]) => Uint8Array {
  const { diff = false, buffer = new ArrayBuffer(1024 * 1024 * 100), epsilon = 1e-4, byteOffset = 0 } = options;
  const view = new DataView(buffer);
  const shadowMap = diff ? new Map<unknown, unknown[]>() : undefined;
  const serializers = components.map((c) => createComponentSerializer(c, diff, shadowMap, epsilon));
  return (indices) => {
    let offset = byteOffset;
    for (let i = 0; i < indices.length; i++) {
      for (let j = 0; j < serializers.length; j++) {
        offset += serializers[j](view, offset, indices[i], j);
      }
    }
    return new Uint8Array(buffer, byteOffset, offset - byteOffset);
  };
}

// ── SoA deserializer (patched: accepts Uint8Array | ArrayBuffer) ─────────────

export interface SoADeserializerOptions {
  diff?: boolean;
}

export function createSoADeserializerNoCopy(
  components: object[],
  options: SoADeserializerOptions = {},
): (packet: Uint8Array | ArrayBuffer, entityIdMapping?: Map<number, number>) => void {
  const { diff = false } = options;
  const deserializers = components.map((c) => createComponentDeserializer(c, diff));
  return (packet, entityIdMapping) => {
    const pkt = packet instanceof Uint8Array ? packet : new Uint8Array(packet);
    const view = new DataView(pkt.buffer, pkt.byteOffset, pkt.byteLength);
    let offset = 0;
    while (offset < pkt.length) {
      if (diff) {
        const { value: _eid } = typeGetters[$u32](view, offset);
        const { value: cid } = typeGetters[$u32](view, offset + 4);
        offset += deserializers[cid](view, offset, entityIdMapping);
      } else {
        for (const d of deserializers) {
          offset += d(view, offset, entityIdMapping);
        }
      }
    }
  };
}

// ── relation helpers ────────────────────────────────────────────────────────

function serializeRelationData(
  data: unknown,
  eid: number,
  dataView: DataView,
  offset: number,
): number {
  if (!data) return offset;
  if (Array.isArray(data)) {
    const value = (data as Record<number, number>)[eid];
    if (value !== undefined) {
      if ($ref in (data as object)) { dataView.setUint32(offset, value); return offset + 4; }
      dataView.setFloat64(offset, value); return offset + 8;
    }
    return offset;
  }
  if (typeof data === 'object') {
    const keys = Object.keys(data as object).sort();
    for (const key of keys) {
      const arr = (data as Record<string, Record<number, number>>)[key];
      const value = arr[eid];
      if (value === undefined) continue;
      if (arr instanceof Int8Array || $i8 in arr) { dataView.setInt8(offset, value); offset += 1; }
      else if (arr instanceof Uint8Array || $u8 in arr) { dataView.setUint8(offset, value); offset += 1; }
      else if (arr instanceof Int16Array || $i16 in arr) { dataView.setInt16(offset, value); offset += 2; }
      else if (arr instanceof Uint16Array || $u16 in arr) { dataView.setUint16(offset, value); offset += 2; }
      else if (arr instanceof Int32Array || $i32 in arr) { dataView.setInt32(offset, value); offset += 4; }
      else if (arr instanceof Uint32Array || $u32 in arr || $ref in arr) { dataView.setUint32(offset, value); offset += 4; }
      else if (arr instanceof Float32Array || $f32 in arr) { dataView.setFloat32(offset, value); offset += 4; }
      else { dataView.setFloat64(offset, value); offset += 8; }
    }
  }
  return offset;
}

function deserializeRelationData(
  data: unknown,
  eid: number,
  dataView: DataView,
  offset: number,
  entityIdMapping?: Map<number, number>,
): number {
  if (!data) return offset;
  if (Array.isArray(data)) {
    if ($ref in (data as object)) {
      const value = dataView.getUint32(offset);
      const mapped = entityIdMapping ? (entityIdMapping.get(value) ?? value) : value;
      (data as Record<number, number>)[eid] = mapped;
      return offset + 4;
    }
    (data as Record<number, number>)[eid] = dataView.getFloat64(offset);
    return offset + 8;
  }
  if (typeof data === 'object') {
    const keys = Object.keys(data as object).sort();
    for (const key of keys) {
      const arr = (data as Record<string, Record<number, number>>)[key];
      if (arr instanceof Int8Array || $i8 in arr) { arr[eid] = dataView.getInt8(offset); offset += 1; }
      else if (arr instanceof Uint8Array || $u8 in arr) { arr[eid] = dataView.getUint8(offset); offset += 1; }
      else if (arr instanceof Int16Array || $i16 in arr) { arr[eid] = dataView.getInt16(offset); offset += 2; }
      else if (arr instanceof Uint16Array || $u16 in arr) { arr[eid] = dataView.getUint16(offset); offset += 2; }
      else if (arr instanceof Int32Array || $i32 in arr) { arr[eid] = dataView.getInt32(offset); offset += 4; }
      else if (arr instanceof Uint32Array || $u32 in arr || $ref in arr) {
        const value = dataView.getUint32(offset);
        arr[eid] = ($ref in arr && entityIdMapping) ? (entityIdMapping.get(value) ?? value) : value;
        offset += 4;
      }
      else if (arr instanceof Float32Array || $f32 in arr) { arr[eid] = dataView.getFloat32(offset); offset += 4; }
      else { arr[eid] = dataView.getFloat64(offset); offset += 8; }
    }
  }
  return offset;
}

// ── Snapshot serializer (patched: returns Uint8Array view, no internal slices) ─

const DEFAULT_SNAPSHOT_BUFFER = 1024 * 1024 * 100;

export function createSnapshotSerializerNoCopy(
  world: World,
  components: object[],
  buffer: ArrayBuffer = new ArrayBuffer(DEFAULT_SNAPSHOT_BUFFER),
): (selectedEntities?: readonly number[]) => Uint8Array {
  const dataView = new DataView(buffer);
  let headerEnd = 0;

  const serializeEntityComponentRelationships = (entities: readonly number[]): void => {
    const entityCount = entities.length;
    dataView.setUint32(0, entityCount);
    let offset = 4;
    for (const entityId of entities) {
      dataView.setUint32(offset, entityId);
      offset += 4;
      const componentCountOffset = offset;
      offset += 1; // reserve for component count
      let componentCount = 0;
      for (let j = 0; j < components.length; j++) {
        const component = components[j];
        if (isRelation(component as any)) {
          const targets = getRelationTargets(world, entityId, component as any);
          for (const target of targets) {
            dataView.setUint8(offset, j);
            offset += 1;
            dataView.setUint32(offset, target);
            offset += 4;
            const relationData = (component as (target: number) => unknown)(target);
            offset = serializeRelationData(relationData, entityId, dataView, offset);
            componentCount++;
          }
        } else if (hasComponent(world, entityId, component)) {
          dataView.setUint8(offset, j);
          offset += 1;
          componentCount++;
        }
      }
      dataView.setUint8(componentCountOffset, componentCount);
    }
    headerEnd = offset;
  };

  return (selectedEntities) => {
    const entities = selectedEntities ?? getAllEntities(world);
    serializeEntityComponentRelationships(entities);

    // SoA serializer writes directly into the same buffer starting at headerEnd
    const soaData = createSoASerializerNoCopy(components, { buffer, byteOffset: headerEnd })(entities);

    return new Uint8Array(buffer, 0, headerEnd + soaData.byteLength);
  };
}

// ── Snapshot deserializer (patched: accepts Uint8Array | ArrayBuffer, no slice) ─

export function createSnapshotDeserializerNoCopy(
  world: World,
  components: object[],
  idMap?: Map<number, number>,
): (packet: Uint8Array | ArrayBuffer, idMapOverride?: Map<number, number>) => Map<number, number> {
  const entityIdMapping = idMap ?? new Map<number, number>();
  const soaDeserializer = createSoADeserializerNoCopy(components);

  return (packet, idMapOverride) => {
    const currentMapping = idMapOverride ?? entityIdMapping;
    const pkt = packet instanceof Uint8Array ? packet : new Uint8Array(packet);
    const dataView = new DataView(pkt.buffer, pkt.byteOffset, pkt.byteLength);
    let offset = 0;

    // Header: entity count + per-entity component list
    const entityCount = dataView.getUint32(offset);
    offset += 4;

    for (let ei = 0; ei < entityCount; ei++) {
      const pktEid = dataView.getUint32(offset);
      offset += 4;
      let worldEid = currentMapping.get(pktEid);
      if (worldEid === undefined) {
        worldEid = addEntity(world);
        currentMapping.set(pktEid, worldEid);
      }
      const componentCount = dataView.getUint8(offset);
      offset += 1;
      for (let i = 0; i < componentCount; i++) {
        const componentIndex = dataView.getUint8(offset);
        offset += 1;
        const component = components[componentIndex];
        if (isRelation(component as any)) {
          const targetId = dataView.getUint32(offset);
          offset += 4;
          let worldTargetId = currentMapping.get(targetId);
          if (worldTargetId === undefined) {
            worldTargetId = addEntity(world);
            currentMapping.set(targetId, worldTargetId);
          }
          const relComponent = (component as (t: number) => unknown)(worldTargetId);
          addComponent(world, worldEid, relComponent);
          offset = deserializeRelationData(relComponent, worldEid, dataView, offset, currentMapping);
        } else {
          addComponent(world, worldEid, component);
        }
      }
    }

    // SoA tail — use a view into the remaining bytes instead of slicing
    const soaView = new Uint8Array(pkt.buffer, pkt.byteOffset + offset, pkt.byteLength - offset);
    soaDeserializer(soaView, currentMapping);

    return currentMapping;
  };
}
