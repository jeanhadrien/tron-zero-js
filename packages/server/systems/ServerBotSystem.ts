import { eventGetter, inputGetter, System } from '@tron0/shared/interfaces/System';
import { PlayerInputTickRingBuffer } from '@tron0/shared/PlayerInputBuffer';
import PlayerSystem, { IsAlive, PlayerId } from '@tron0/shared/systems/PlayerSystem';
import { Logger } from '@tron0/shared/Logger';
import { ECSGameRoom } from '@tron0/shared/ECSGameRoom';
import type { SimulationContext } from '@tron0/shared/interfaces/SimulationContext';
import { GameEventType } from '@tron0/shared/interfaces/GameEvent';
import { BOT_AI_BUDGET } from '@tron0/shared/spatial/BotAiBudget';
import { BotBrain } from '../bot/BotBrain';
import { resolveDegradationLevel } from '../bot/BotDegradation';
import type { BotStrategy } from '../bot/BotStrategyWeights';

const logger = new Logger('BotSystem');

const BOT_COUNT = 3;

const FIRST_NAMES = [
  'Kova',
  'Atro',
  'Hayzeur',
  'Nobody',
  'Rampiece',
  'Hyouz',
  'Ksiyae',
  'Koniev',
  'Dys',
  'Shelby',
  'Ryv',
  'Tangz',
  'Kaflao',
  'Boby',
];

const TITLES: Record<BotStrategy, string> = {
  CUT_OFF: 'The Slicer',
  BOX_IN: 'The Constrictor',
  SPEED_DEMON: 'The Demon',
  TRAPPER: 'The Trapper',
};

function randomStrategy(): BotStrategy {
  const strategies: BotStrategy[] = ['CUT_OFF', 'BOX_IN', 'SPEED_DEMON', 'TRAPPER'];
  return strategies[Math.floor(Math.random() * strategies.length)];
}

function randomName(strategy: BotStrategy): string {
  const name = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  return `${name} ${TITLES[strategy]}`;
}

export default class BotSystem extends System {
  readonly key = 'bot';

  private inputBuffer: PlayerInputTickRingBuffer | null = null;
  private lastActionTick = new Map<number, number>();
  private cooldownUntilTick = new Map<number, number>();
  private actionCooldownTicks = BOT_AI_BUDGET.ACTION_COOLDOWN_TICKS;
  private botEids: number[] = [];
  private brains = new Map<number, BotBrain>();
  private room!: ECSGameRoom;

  getComponents(): object[] {
    return [];
  }

  getBotCount(): number {
    return this.botEids.length;
  }

  init(ctx: SimulationContext): void {
    this.room = ctx as ECSGameRoom;

    for (let i = 1; i <= BOT_COUNT; i++) {
      const botId = `bot${i}`;
      PlayerSystem.createPlayer(this.room, botId);
      PlayerSystem.spawnPlayer(this.room, botId, this.room.tick);
      const eid = PlayerSystem.getPlayerEidByStringId(this.room, botId);
      if (eid === null) {
        logger.error('Failed to create bot', botId);
        continue;
      }
      const strategy = randomStrategy();
      this.botEids.push(eid);
      this.brains.set(eid, new BotBrain(strategy));
      logger.info(`Bot initialized: ${randomName(strategy)} (Strategy: ${strategy})`);
    }
  }

  setInputBuffer(buffer: PlayerInputTickRingBuffer): void {
    this.inputBuffer = buffer;
  }

  update(getInput?: inputGetter, _getEvents?: eventGetter): void {
    if (!this.inputBuffer) return;

    const tick = this.room.tick;
    const degradationLevel = resolveDegradationLevel(this.room.ticksInBatch ?? 1);

    for (const eid of this.botEids) {
      if (!IsAlive[eid]) {
        this.brains.get(eid)?.memory.reset();
        this.room.addEvent({
          type: GameEventType.PlayerSpawn,
          tick,
          playerId: PlayerId[eid],
        });
        continue;
      }

      if (this.shouldSkipInput(eid, tick, getInput)) continue;

      const brain = this.brains.get(eid);
      if (!brain) continue;

      const t0 = performance.now();
      const decision = brain.decide(this.room, eid, tick, { degradationLevel });
      const elapsed = performance.now() - t0;

      if (decision) {
        logger.debug('bot decision', {
          eid,
          mode: decision.mode,
          inputs: decision.inputs.length,
          ms: elapsed.toFixed(2),
          degraded: degradationLevel,
        });

        const playerId = PlayerId[eid];
        for (const input of decision.inputs) {
          this.room.addInput({ tick: input.tick, playerId, break: false, turn: input.turn });
        }
        this.lastActionTick.set(eid, tick);
        if (decision.cooldownUntilTick !== undefined) {
          this.cooldownUntilTick.set(eid, decision.cooldownUntilTick);
        }
      }
    }
  }

  /** Independent checks: pre-queued input, standard cooldown, extended TRAPPER cooldown. */
  private shouldSkipInput(eid: number, tick: number, getInput?: inputGetter): boolean {
    const playerId = PlayerId[eid];
    if (getInput?.(playerId)?.turn) return true;

    const lastTick = this.lastActionTick.get(eid) ?? 0;
    if (tick - lastTick < this.actionCooldownTicks) return true;

    const until = this.cooldownUntilTick.get(eid);
    if (until !== undefined && tick < until) return true;

    return false;
  }
}
