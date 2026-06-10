import { BotStrategyWeights, type BotStrategy } from './BotStrategyWeights';
import { BotDegradationLevel } from './BotDegradation';

export type DecisionMode = 'ESCAPE' | 'SURVIVAL' | 'ATTACK' | 'EXPLORE';
export type CandidateTurn = 'hold' | 'left' | 'right';

export interface CandidateOutcome {
  turn: CandidateTurn;
  projectedFreedom: number;
  freedomDelta: number;
  projectedClearance: number;
  minLateralClearance: number;
  trapScore: number;
}

export interface DecisionContext {
  eid: number;
  tick: number;
  strategy: BotStrategy;
  reachableArea: number;
  cardinalExits: number;
  freedomTrend: number;
  freedomGradient_best: number;
  distFront: number;
  distLeft: number;
  distRight: number;
  entrapmentScore: number;
  entrapmentPressure: boolean;
  wantsToSlide: boolean;
  targetEnemyEid: number | null;
  degradationLevel: BotDegradationLevel;
  mode: DecisionMode;
}

/** Score a single turn candidate for the active decision mode. */
export function scoreCandidate(c: CandidateOutcome, ctx: DecisionContext): number {
  const escape = 1.2 * c.projectedFreedom + 0.8 * c.freedomDelta + 0.6 * c.projectedClearance;
  const survival = 0.7 * c.minLateralClearance + 1.0 * c.projectedClearance + 0.2 * c.freedomDelta;
  const trap = c.trapScore + 0.1 * c.freedomDelta - (c.turn === 'hold' ? 6 : 0);
  const explore = 0.3 * c.projectedFreedom + 0.2 * c.projectedClearance + 0.15 * c.freedomDelta + c.trapScore * 0.4;
  const strategy = BotStrategyWeights.apply(ctx.strategy, c, ctx);

  switch (ctx.mode) {
    case 'ESCAPE':
      return escape;
    case 'SURVIVAL':
      return survival;
    case 'ATTACK':
      return trap + strategy;
    case 'EXPLORE':
      return explore + strategy * 0.6;
    default:
      return explore;
  }
}

/** Pick the highest-scoring candidate; ties broken deterministically. */
export function pickBestCandidate(candidates: CandidateOutcome[], ctx: DecisionContext): CandidateOutcome {
  let best = candidates[0];
  let bestScore = scoreCandidate(best, ctx);

  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i];
    const s = scoreCandidate(c, ctx);
    if (s > bestScore) {
      best = c;
      bestScore = s;
    } else if (s === bestScore && tieBreak(c, best, ctx) > 0) {
      best = c;
    }
  }

  return best;
}

function tieBreak(a: CandidateOutcome, b: CandidateOutcome, ctx: DecisionContext): number {
  if (a.turn === 'hold' && b.turn !== 'hold') return -1;
  if (b.turn === 'hold' && a.turn !== 'hold') return 1;
  const pref = (ctx.eid + ctx.tick) % 2 === 0 ? 'left' : 'right';
  if (a.turn === pref) return 1;
  if (b.turn === pref) return -1;
  return 0;
}