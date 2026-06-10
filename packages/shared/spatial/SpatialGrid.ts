import { rasterizeAxisAlignedSegment } from './segmentRaster';
import type { SegmentId, SegmentKind, SpatialSegment } from './SpatialSegment';
import type { GridBounds } from './gridTraversal';

const EMPTY_BUCKET: SegmentId[] = [];

/** Uniform spatial grid with flat cell buckets for static segment indexing. */
export class SpatialGrid implements GridBounds {
  readonly cols: number;
  readonly rows: number;
  readonly cellSize: number;
  readonly width: number;
  readonly height: number;
  readonly originX: number;
  readonly originY: number;
  readonly cellCount: number;

  private cells: SegmentId[][];
  private segments = new Map<SegmentId, SpatialSegment>();
  private segmentCells = new Map<SegmentId, number[]>();
  private playerStaticSegments = new Map<number, SegmentId[]>();
  private nextId: SegmentId = 1;

  constructor(width: number, height: number, cellSize: number, originX = 0, originY = 0) {
    this.width = width;
    this.height = height;
    this.cellSize = cellSize;
    this.originX = originX;
    this.originY = originY;
    this.cols = Math.ceil(width / cellSize);
    this.rows = Math.ceil(height / cellSize);
    this.cellCount = this.cols * this.rows;
    this.cells = Array.from({ length: this.cellCount }, () => EMPTY_BUCKET);
  }

  /** Map world coordinates to grid cell indices (clamped). */
  worldToCell(x: number, y: number): { cx: number; cy: number } {
    const cx = Math.max(0, Math.min(this.cols - 1, Math.floor((x - this.originX) / this.cellSize)));
    const cy = Math.max(0, Math.min(this.rows - 1, Math.floor((y - this.originY) / this.cellSize)));
    return { cx, cy };
  }

  getSegmentsInCell(cx: number, cy: number): readonly SpatialSegment[] {
    if (cx < 0 || cx >= this.cols || cy < 0 || cy >= this.rows) return [];
    const bucket = this.cells[cy * this.cols + cx];
    if (bucket === EMPTY_BUCKET || bucket.length === 0) return [];
    return bucket.map((id) => this.segments.get(id)!);
  }

  getSegmentIdsInCell(cx: number, cy: number): readonly SegmentId[] {
    if (cx < 0 || cx >= this.cols || cy < 0 || cy >= this.rows) return [];
    return this.cells[cy * this.cols + cx];
  }

  getSegmentIdsAtKey(cellKey: number): readonly SegmentId[] {
    if (cellKey < 0 || cellKey >= this.cellCount) return [];
    return this.cells[cellKey];
  }

  getSegment(id: SegmentId): SpatialSegment | undefined {
    return this.segments.get(id);
  }

  getAllSegments(): Iterable<SpatialSegment> {
    return this.segments.values();
  }

  getPlayerStaticSegmentIds(eid: number): readonly SegmentId[] {
    return this.playerStaticSegments.get(eid) ?? [];
  }

  /** Clear all segments and rebuild cell buckets. */
  clear(): void {
    this.segments.clear();
    this.segmentCells.clear();
    this.playerStaticSegments.clear();
    this.nextId = 1;
    for (let i = 0; i < this.cellCount; i++) {
      this.cells[i] = EMPTY_BUCKET;
    }
  }

  /** Insert a static segment and return its handle. */
  insertSegment(
    kind: SegmentKind,
    ownerEid: number,
    segmentIndex: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ): SegmentId {
    const id = this.nextId++;
    const seg: SpatialSegment = { id, kind, ownerEid, segmentIndex, x1, y1, x2, y2 };
    this.segments.set(id, seg);

    const cellKeys = rasterizeAxisAlignedSegment(
      x1,
      y1,
      x2,
      y2,
      this.cellSize,
      this.cols,
      this.rows,
      this.originX,
      this.originY
    );
    this.segmentCells.set(id, cellKeys);

    for (const key of cellKeys) {
      if (key < 0 || key >= this.cellCount) continue;
      const bucket = this.cells[key];
      if (bucket === EMPTY_BUCKET || bucket === undefined) {
        this.cells[key] = [id];
      } else {
        bucket.push(id);
      }
    }

    if (kind === 'trail_static') {
      let list = this.playerStaticSegments.get(ownerEid);
      if (!list) {
        list = [];
        this.playerStaticSegments.set(ownerEid, list);
      }
      list.push(id);
    }

    return id;
  }

  /** Remove a segment from the grid and all cell buckets. */
  removeSegment(id: SegmentId): void {
    const seg = this.segments.get(id);
    if (!seg) return;

    const cellKeys = this.segmentCells.get(id) ?? [];
    for (const key of cellKeys) {
      const bucket = this.cells[key];
      if (bucket === EMPTY_BUCKET) continue;
      const idx = bucket.indexOf(id);
      if (idx >= 0) bucket.splice(idx, 1);
      if (bucket.length === 0) this.cells[key] = EMPTY_BUCKET;
    }

    if (seg.kind === 'trail_static') {
      const list = this.playerStaticSegments.get(seg.ownerEid);
      if (list) {
        const idx = list.indexOf(id);
        if (idx >= 0) list.splice(idx, 1);
      }
    }

    this.segments.delete(id);
    this.segmentCells.delete(id);
  }

  /** Remove all segments owned by a player. */
  removePlayerSegments(eid: number): void {
    const ids = [...(this.playerStaticSegments.get(eid) ?? [])];
    for (const id of ids) {
      this.removeSegment(id);
    }
    this.playerStaticSegments.delete(eid);
  }

  /** Update geometry of an existing static segment (tail partial slide). */
  updateSegmentGeometry(id: SegmentId, x1: number, y1: number, x2: number, y2: number): void {
    const seg = this.segments.get(id);
    if (!seg) return;

    const oldKeys = this.segmentCells.get(id) ?? [];
    for (const key of oldKeys) {
      const bucket = this.cells[key];
      if (bucket === EMPTY_BUCKET) continue;
      const idx = bucket.indexOf(id);
      if (idx >= 0) bucket.splice(idx, 1);
      if (bucket.length === 0) this.cells[key] = EMPTY_BUCKET;
    }

    seg.x1 = x1;
    seg.y1 = y1;
    seg.x2 = x2;
    seg.y2 = y2;

    const newKeys = rasterizeAxisAlignedSegment(
      x1,
      y1,
      x2,
      y2,
      this.cellSize,
      this.cols,
      this.rows,
      this.originX,
      this.originY
    );
    this.segmentCells.set(id, newKeys);

    for (const key of newKeys) {
      if (key < 0 || key >= this.cellCount) continue;
      const bucket = this.cells[key];
      if (bucket === EMPTY_BUCKET || bucket === undefined) {
        this.cells[key] = [id];
      } else if (!bucket.includes(id)) {
        bucket.push(id);
      }
    }
  }

  /** Register a player with no static segments yet. */
  registerPlayer(eid: number): void {
    if (!this.playerStaticSegments.has(eid)) {
      this.playerStaticSegments.set(eid, []);
    }
  }
}