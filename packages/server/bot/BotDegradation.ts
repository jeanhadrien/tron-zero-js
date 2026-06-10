import { BOT_AI_BUDGET } from '@tron0/shared/spatial/BotAiBudget';

export enum BotDegradationLevel {
  FULL = 0,
  TIER_1 = 1,
  TIER_2 = 2,
}

/** Map batch tick depth to bot AI degradation tier. */
export function resolveDegradationLevel(ticksInBatch: number, frameAiMs?: number): BotDegradationLevel {
  if (frameAiMs !== undefined && frameAiMs > BOT_AI_BUDGET.PER_FRAME_BUDGET_MS) {
    return BotDegradationLevel.TIER_2;
  }
  if (ticksInBatch > 3) return BotDegradationLevel.TIER_2;
  if (ticksInBatch > 1) return BotDegradationLevel.TIER_1;
  return BotDegradationLevel.FULL;
}