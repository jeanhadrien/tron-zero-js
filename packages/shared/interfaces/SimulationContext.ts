import type { World } from 'bitecs';
import type GameClock from '../GameClock';
import type { PlayerInputTickRingBuffer } from '../PlayerInputBuffer';
import type { GameEventTickRingBuffer } from '../GameEventBuffer';
import type { ISpatialQuery } from '../spatial/SpatialQuery';
import type { ISpatialGridMutator } from '../spatial/SpatialGridMutator';

/**
 * Minimal read surface that simulation systems need from the room.
 * ECSGameRoom implements this so systems never depend on the full
 * networking / snapshot / identity surface.
 */
export interface SimulationContext {
  world: World;
  tick: number;
  clock: GameClock;
  playerInputBuffer: PlayerInputTickRingBuffer;
  gameEventBuffer: GameEventTickRingBuffer;
  dirtyEntities: Set<number>;
  components: object[];
  /** Read-only spatial queries. Set by SpatialGridSystem.init. */
  spatialQuery?: ISpatialQuery;
  /** Spatial grid mutation + rebuild. Implemented by SpatialGridSystem. */
  spatialGrid?: ISpatialGridMutator;
  /** Simulation ticks processed in the current frame batch (≥ 1). */
  ticksInBatch: number;
}
