import { wrapAngle } from '@tron0/shared/math';
import { Direction } from '@tron0/shared/systems/PlayerSystem';
import type { CandidateOutcome, DecisionContext } from './TurnCandidateScorer';

export type BotStrategy = 'CUT_OFF' | 'BOX_IN' | 'SPEED_DEMON' | 'TRAPPER';

/** Apply legacy strategy biases as score modifiers on candidate outcomes. */
export class BotStrategyWeights {
  static apply(strategy: BotStrategy, c: CandidateOutcome, ctx: DecisionContext): number {
    switch (strategy) {
      case 'CUT_OFF':
        return headingCutoffBonus(c, ctx);
      case 'BOX_IN':
        return boxInBonus(c, ctx);
      case 'SPEED_DEMON':
        return ctx.wantsToSlide ? c.projectedClearance * 0.5 : c.turn !== 'hold' ? 4 : 0;
      case 'TRAPPER':
        return c.turn !== 'hold' ? 14 : 0;
      default:
        return 0;
    }
  }
}

function headingCutoffBonus(c: CandidateOutcome, ctx: DecisionContext): number {
  if (!ctx.targetEnemyEid) return 0;
  const turnAlign = c.turn === 'left' ? -1 : c.turn === 'right' ? 1 : 0;
  return turnAlign !== 0 ? Math.abs(Math.sin(wrapAngle(Direction[ctx.eid]))) * 12 : 0;
}

function boxInBonus(c: CandidateOutcome, ctx: DecisionContext): number {
  if (c.turn === 'hold') return -4;
  const lateral = Math.min(ctx.distLeft, ctx.distRight);
  return lateral > 60 ? 10 : 4;
}