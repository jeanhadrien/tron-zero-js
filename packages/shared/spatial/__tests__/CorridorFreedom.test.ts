import { describe, expect, it } from 'vitest';
import { SpatialGrid } from '../SpatialGrid';
import { SpatialQueryImpl } from '../SpatialQuery';
import { measureFreedom } from '../CorridorFreedom';
import type { SimulationContext } from '../../interfaces/SimulationContext';

function makeQuery(grid: SpatialGrid) {
  return new SpatialQueryImpl(grid, {} as SimulationContext);
}

describe('measureFreedom', () => {
  it('returns positive reachable area in an open cell', () => {
    const grid = new SpatialGrid(2400, 2400, 80);
    const query = makeQuery(grid);

    const snap = measureFreedom(query, 1200, 1200);
    expect(snap.reachableArea).toBeGreaterThan(0);
    expect(snap.cardinalExits).toBeGreaterThanOrEqual(2);
  });

  it('returns zero reachable area when fully enclosed', () => {
    const grid = new SpatialGrid(2400, 2400, 80);
    const cx = Math.floor(1200 / 80);
    const cy = Math.floor(1200 / 80);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const x = (cx + dx) * 80 + 40;
        const y = (cy + dy) * 80 + 40;
        grid.insertSegment('arena', -1, 0, x - 40, y, x + 40, y);
        grid.insertSegment('arena', -1, 1, x, y - 40, x, y + 40);
      }
    }

    const query = makeQuery(grid);
    const snap = measureFreedom(query, 1200, 1200, { visitBudget: 200, maxRadius: 6 });
    expect(snap.cardinalExits).toBe(0);
    expect(snap.reachableArea).toBeLessThanOrEqual(1);
  });
});