import { Direction, Position } from '../systems/PlayerSystem';
import { collectActiveSegmentCells } from './CorridorFreedom';
import { rasterizeAxisAlignedSegment } from './segmentRaster';
import type { ISpatialQuery } from './SpatialQuery';

const ROTATION = Math.PI / 2;

/** Mutable blocked-cell overlay for hypothetical turn segments during lookahead. */
export class CandidateOverlay {
  private blocked = new Set<number>();

  private constructor(
    private readonly query: ISpatialQuery,
    centerX: number,
    centerY: number,
    radiusCells: number,
    activeOwners: readonly number[]
  ) {
    const { cols, rows } = query.getGridDimensions();
    const { cx: ccx, cy: ccy } = query.worldToCell(centerX, centerY);

    for (let dy = -radiusCells; dy <= radiusCells; dy++) {
      for (let dx = -radiusCells; dx <= radiusCells; dx++) {
        const cx = ccx + dx;
        const cy = ccy + dy;
        if (cx < 0 || cx >= cols || cy < 0 || cy >= rows) continue;
        if (query.isCellBlocked(cx, cy)) {
          this.blocked.add(cy * cols + cx);
        }
      }
    }

    for (const key of collectActiveSegmentCells(query, activeOwners)) {
      this.blocked.add(key);
    }
  }

  /** Build overlay from grid + active trail segments near the bot. */
  static create(
    query: ISpatialQuery,
    centerX: number,
    centerY: number,
    radiusCells: number,
    activeOwners: readonly number[]
  ): CandidateOverlay {
    return new CandidateOverlay(query, centerX, centerY, radiusCells, activeOwners);
  }

  get blockedCells(): ReadonlySet<number> {
    return this.blocked;
  }

  /** Rasterize a hypothetical axis-aligned turn segment onto the overlay. */
  addTurnSegment(x1: number, y1: number, x2: number, y2: number): void {
    const { cols, rows, cellSize } = this.query.getGridDimensions();
    for (const key of rasterizeAxisAlignedSegment(x1, y1, x2, y2, cellSize, cols, rows, 0, 0)) {
      this.blocked.add(key);
    }
  }

  /** Apply a left/right turn at the bot's current position and rasterize the new segment. */
  addCandidateTurn(eid: number, turn: 'left' | 'right' | 'hold'): void {
    if (turn === 'hold') return;
    const x = Position.x[eid];
    const y = Position.y[eid];
    const dir = Direction[eid];
    const newDir = turn === 'left' ? dir - ROTATION : dir + ROTATION;
    const dx = Math.cos(newDir);
    const dy = Math.sin(newDir);
    const len = 80;
    this.addTurnSegment(x, y, x + dx * len, y + dy * len);
  }
}