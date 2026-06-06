import type { PlayerInput } from '@tron0/shared/interfaces/PlayerInput';

/** Return a turn input — always advances to a fresh tick slot. */
export function TurnCommand(
  tick: number,
  playerId: string,
  direction: 'left' | 'right',
  alpha?: number,
): PlayerInput {
  return { tick, playerId, turn: direction, alpha };
}

/** Return a break toggle input — merges into the current target tick. */
export function BreakCommand(tick: number, playerId: string): PlayerInput {
  return { tick, playerId, break: true };
}
