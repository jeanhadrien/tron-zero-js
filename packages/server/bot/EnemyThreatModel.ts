import { query } from 'bitecs';
import type { SimulationContext } from '@tron0/shared/interfaces/SimulationContext';
import { Direction, IsAlive, Player, Position } from '@tron0/shared/systems/PlayerSystem';
import { angleBetween, distanceBetween, wrapAngle } from '@tron0/shared/math';
import type { FreedomSnapshot } from '@tron0/shared/spatial/CorridorFreedom';
import { measureFreedom } from '@tron0/shared/spatial/CorridorFreedom';
import type { ISpatialQuery } from '@tron0/shared/spatial/SpatialQuery';
import { BOT_AI_BUDGET } from '@tron0/shared/spatial/BotAiBudget';

const BASE_SPEED = 360;

/** Pick the most profitable enemy to hunt (proximity + trap vulnerability). */
export function selectHuntTarget(
  ctx: SimulationContext,
  selfEid: number,
  spatial: ISpatialQuery
): number | null {
  let best: number | null = null;
  let bestScore = -Infinity;

  for (const eid of Array.from(queryPlayers(ctx))) {
    if (eid === selfEid || !IsAlive[eid]) continue;

    const enemyFreedom = measureFreedom(spatial, Position.x[eid], Position.y[eid], {
      visitBudget: BOT_AI_BUDGET.BFS_VISIT_BUDGET_LOOKAHEAD,
      maxRadius: 12,
    });

    const score = huntScore(selfEid, eid, enemyFreedom);
    if (score > bestScore) {
      bestScore = score;
      best = eid;
    }
  }

  return best;
}

function* queryPlayers(ctx: SimulationContext): Generator<number> {
  for (const eid of Array.from(query(ctx.world, [Player]))) yield eid;
}

/** Offensive target score: close, boxed-in enemies are preferred. */
export function huntScore(selfEid: number, enemyEid: number, enemyFreedom: FreedomSnapshot): number {
  const sx = Position.x[selfEid];
  const sy = Position.y[selfEid];
  const ex = Position.x[enemyEid];
  const ey = Position.y[enemyEid];

  const dist = distanceBetween(sx, sy, ex, ey);
  if (dist > BOT_AI_BUDGET.HUNT_RANGE) return -Infinity;

  const proximity = ((BOT_AI_BUDGET.HUNT_RANGE - dist) / BOT_AI_BUDGET.HUNT_RANGE) * 50;
  const vulnerability = Math.max(0, 180 - enemyFreedom.reachableArea) * 0.35;
  const lowExits = Math.max(0, 3 - enemyFreedom.cardinalExits) * 12;

  const angleToEnemy = angleBetween(sx, sy, ex, ey);
  const selfDir = wrapAngle(Direction[selfEid]);
  const approachAlign = Math.max(0, 1 - Math.abs(wrapAngle(angleToEnemy - selfDir)) / Math.PI);
  const intercept = approachAlign * 18;

  return proximity + vulnerability + lowExits + intercept;
}

/** Project enemy position straight ahead for trap scoring. */
export function projectPosition(
  eid: number,
  ticks: number,
  tickTimeMs: number,
  turn?: 'left' | 'right'
): { x: number; y: number; dir: number } {
  let dir = Direction[eid];
  if (turn === 'left') dir -= Math.PI / 2;
  if (turn === 'right') dir += Math.PI / 2;

  const speed = BASE_SPEED * tickTimeMs / 1000;
  const dist = speed * ticks;
  const x = Position.x[eid] + Math.cos(dir) * dist;
  const y = Position.y[eid] + Math.sin(dir) * dist;
  return { x, y, dir };
}

/** Per-candidate trap score: how much the bot's turn shrinks enemy escape space. */
export function computeTrapScore(
  spatial: ISpatialQuery,
  enemyEid: number,
  enemyFreedomNow: number,
  botCandidateTurn: 'left' | 'right' | 'hold',
  tickTimeMs: number
): number {
  const projected = projectPosition(enemyEid, BOT_AI_BUDGET.LOOKAHEAD_TICKS, tickTimeMs);
  const enemyFreedomAfter = measureFreedom(spatial, projected.x, projected.y, {
    visitBudget: BOT_AI_BUDGET.BFS_VISIT_BUDGET_LOOKAHEAD,
    maxRadius: 12,
  }).reachableArea;

  const delta = enemyFreedomNow - enemyFreedomAfter;
  const turnBonus = botCandidateTurn === 'hold' ? 0 : 14;
  return delta * BOT_AI_BUDGET.TRAP_SCORE_MULTIPLIER + turnBonus;
}