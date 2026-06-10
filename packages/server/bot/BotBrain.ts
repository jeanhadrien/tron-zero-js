import type { SimulationContext } from '@tron0/shared/interfaces/SimulationContext';
import { Position, TargetSpeedMult } from '@tron0/shared/systems/PlayerSystem';
import { resolveActiveSegmentOwners } from '@tron0/shared/spatial/activeSegments';
import { botRayOptions, castRayFan } from '@tron0/shared/spatial/BotRaycastSensing';
import { BOT_AI_BUDGET } from '@tron0/shared/spatial/BotAiBudget';
import { CandidateOverlay } from '@tron0/shared/spatial/CandidateOverlay';
import { measureFreedom } from '@tron0/shared/spatial/CorridorFreedom';
import { BotDegradationLevel } from './BotDegradation';
import { BotMemory } from './BotMemory';
import { computeTrapScore, projectPosition, selectHuntTarget } from './EnemyThreatModel';
import {
  pickBestCandidate,
  type CandidateOutcome,
  type CandidateTurn,
  type DecisionContext,
  type DecisionMode,
} from './TurnCandidateScorer';
import type { BotStrategy } from './BotStrategyWeights';

export interface BotDecisionInput {
  tick: number;
  turn: 'left' | 'right';
}

export interface BotDecision {
  inputs: BotDecisionInput[];
  cooldownUntilTick?: number;
  mode: DecisionMode;
}

export interface BotBrainOptions {
  degradationLevel: BotDegradationLevel;
}

/** Layered labyrinth-aware bot decision engine backed by the spatial grid. */
export class BotBrain {
  readonly memory = new BotMemory();

  constructor(readonly strategy: BotStrategy) {}

  /** Produce a turn decision for one bot tick, or null when no action is needed. */
  decide(ctx: SimulationContext, eid: number, tick: number, options: BotBrainOptions): BotDecision | null {
    const spatial = ctx.spatialQuery;
    if (!spatial) return null;

    const activeOwners = resolveActiveSegmentOwners(ctx);
    const rays = castRayFan(spatial, eid, botRayOptions(activeOwners));
    const tickTimeMs = ctx.clock.referenceTickTimeMs;

    const skipBfs = options.degradationLevel >= BotDegradationLevel.TIER_2;
    const skipLookahead = options.degradationLevel >= BotDegradationLevel.TIER_1;

    const currentFreedom = skipBfs
      ? { reachableArea: 0, cardinalExits: 4, centroidX: Position.x[eid], centroidY: Position.y[eid] }
      : measureFreedom(spatial, Position.x[eid], Position.y[eid]);

    const freedomTrendBefore = this.memory.getFreedomTrend();
    const entrapmentScore = computeEntrapmentScore(currentFreedom, rays.distFront, freedomTrendBefore);
    const freedomTrend = this.memory.update(
      currentFreedom.reachableArea,
      currentFreedom.cardinalExits,
      entrapmentScore
    );

    const targetEnemyEid = skipBfs ? null : selectHuntTarget(ctx, eid, spatial);

    const criticalFront = BOT_AI_BUDGET.SURVIVAL_THRESHOLD_BASE;
    const entrapmentPressure =
      entrapmentScore >= BOT_AI_BUDGET.ENTRAPMENT_ESCAPE_THRESHOLD &&
      currentFreedom.cardinalExits <= 1 &&
      freedomTrend < 0;
    const wantsToSlide = computeWantsToSlide(eid, this.strategy, targetEnemyEid, rays.distLeft, rays.distRight);
    const survivalThreshold = wantsToSlide
      ? BOT_AI_BUDGET.SURVIVAL_THRESHOLD_SLIDE
      : Math.max(
          criticalFront,
          BOT_AI_BUDGET.SURVIVAL_THRESHOLD_MAX - entrapmentScore * 0.15
        );

    let mode: DecisionMode = 'EXPLORE';
    if (options.degradationLevel >= BotDegradationLevel.TIER_2) {
      mode = rays.distFront < criticalFront ? 'SURVIVAL' : 'ATTACK';
    } else if (entrapmentPressure) {
      mode = 'ESCAPE';
    } else if (targetEnemyEid !== null && rays.distFront >= criticalFront) {
      mode = 'ATTACK';
    } else if (rays.distFront < survivalThreshold) {
      mode = 'SURVIVAL';
    } else if (targetEnemyEid !== null) {
      mode = 'ATTACK';
    }

    const candidates = skipLookahead
      ? buildRayOnlyCandidates(rays)
      : buildCandidates(
          eid,
          spatial,
          activeOwners,
          tickTimeMs,
          targetEnemyEid,
          currentFreedom.reachableArea
        );

    const freedomGradient_best = Math.max(...candidates.map((c) => c.freedomDelta));

    const decisionCtx: DecisionContext = {
      eid,
      tick,
      strategy: this.strategy,
      reachableArea: currentFreedom.reachableArea,
      cardinalExits: currentFreedom.cardinalExits,
      freedomTrend,
      freedomGradient_best,
      distFront: rays.distFront,
      distLeft: rays.distLeft,
      distRight: rays.distRight,
      entrapmentScore,
      entrapmentPressure,
      wantsToSlide,
      targetEnemyEid,
      degradationLevel: options.degradationLevel,
      mode,
    };

    const actionable = filterActionableCandidates(candidates, mode, rays.distFront, survivalThreshold);
    const best = pickBestCandidate(actionable, decisionCtx);
    if (best.turn === 'hold') return null;

    const inputs: BotDecisionInput[] = [{ tick, turn: best.turn }];

    if (this.strategy === 'TRAPPER' && mode === 'ATTACK') {
      inputs.push({ tick: tick + 1, turn: best.turn });
      return { inputs, cooldownUntilTick: tick + BOT_AI_BUDGET.TRAPPER_COOLDOWN_TICKS, mode };
    }

    return { inputs, mode };
  }
}

function computeEntrapmentScore(
  freedom: { reachableArea: number; cardinalExits: number },
  distFront: number,
  freedomTrend: number
): number {
  const exitPressure = Math.max(0, 4 - freedom.cardinalExits) * 12;
  const areaPressure = Math.max(0, 200 - freedom.reachableArea) * 0.08;
  const trendPressure = freedomTrend < 0 ? Math.min(15, -freedomTrend * 1.5) : 0;
  const frontRange = BOT_AI_BUDGET.FRONT_PRESSURE_DISTANCE;
  const frontPressure = distFront < frontRange ? ((frontRange - distFront) / frontRange) * 22 : 0;
  return Math.min(100, exitPressure + areaPressure + trendPressure + frontPressure);
}

/** Drop hold when escape/survival needs an immediate turn. */
function filterActionableCandidates(
  candidates: CandidateOutcome[],
  mode: DecisionMode,
  distFront: number,
  survivalThreshold: number
): CandidateOutcome[] {
  if (mode !== 'ESCAPE') return candidates;
  if (distFront >= survivalThreshold * 1.1) return candidates;
  const turns = candidates.filter((c) => c.turn !== 'hold');
  return turns.length > 0 ? turns : candidates;
}

function computeWantsToSlide(
  eid: number,
  strategy: BotStrategy,
  targetEnemyEid: number | null,
  distLeft: number,
  distRight: number
): boolean {
  if (!targetEnemyEid) return false;
  const dist = Math.hypot(
    Position.x[targetEnemyEid] - Position.x[eid],
    Position.y[targetEnemyEid] - Position.y[eid]
  );
  if (strategy === 'SPEED_DEMON' || dist > 150) {
    return TargetSpeedMult[eid] < 1.8 && (distLeft > 15 || distRight > 15);
  }
  return false;
}

function buildRayOnlyCandidates(rays: ReturnType<typeof castRayFan>): CandidateOutcome[] {
  return [
    {
      turn: 'hold',
      projectedFreedom: 0,
      freedomDelta: 0,
      projectedClearance: rays.distFront,
      minLateralClearance: Math.min(rays.distLeft, rays.distRight),
      trapScore: 0,
    },
    {
      turn: 'left',
      projectedFreedom: 0,
      freedomDelta: 0,
      projectedClearance: rays.distLeft,
      minLateralClearance: rays.distLeft,
      trapScore: 0,
    },
    {
      turn: 'right',
      projectedFreedom: 0,
      freedomDelta: 0,
      projectedClearance: rays.distRight,
      minLateralClearance: rays.distRight,
      trapScore: 0,
    },
  ];
}

function buildCandidates(
  eid: number,
  spatial: NonNullable<SimulationContext['spatialQuery']>,
  activeOwners: number[],
  tickTimeMs: number,
  targetEnemyEid: number | null,
  currentReachable: number
): CandidateOutcome[] {
  const turns: CandidateTurn[] = ['hold', 'left', 'right'];
  const enemyFreedomNow = targetEnemyEid
    ? measureFreedom(spatial, Position.x[targetEnemyEid], Position.y[targetEnemyEid], {
        visitBudget: BOT_AI_BUDGET.BFS_VISIT_BUDGET_LOOKAHEAD,
        maxRadius: 12,
      }).reachableArea
    : 0;

  return turns.map((turn) => {
    const overlay = CandidateOverlay.create(
      spatial,
      Position.x[eid],
      Position.y[eid],
      BOT_AI_BUDGET.BFS_MAX_RADIUS,
      activeOwners
    );
    overlay.addCandidateTurn(eid, turn);

    const projected = projectPosition(
      eid,
      BOT_AI_BUDGET.LOOKAHEAD_TICKS,
      tickTimeMs,
      turn === 'hold' ? undefined : turn
    );
    const projectedFreedom = measureFreedom(spatial, projected.x, projected.y, {
      visitBudget: BOT_AI_BUDGET.BFS_VISIT_BUDGET_LOOKAHEAD,
      maxRadius: BOT_AI_BUDGET.BFS_MAX_RADIUS,
      extraBlocked: overlay.blockedCells,
    }).reachableArea;

    const rays = castRayFan(spatial, eid, botRayOptions(activeOwners));

    return {
      turn,
      projectedFreedom,
      freedomDelta: projectedFreedom - currentReachable,
      projectedClearance: turn === 'left' ? rays.distLeft : turn === 'right' ? rays.distRight : rays.distFront,
      minLateralClearance: Math.min(rays.distLeft, rays.distRight),
      trapScore: targetEnemyEid
        ? computeTrapScore(spatial, targetEnemyEid, enemyFreedomNow, turn, tickTimeMs)
        : 0,
    };
  });
}