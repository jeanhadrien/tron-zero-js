import { eventGetter, inputGetter, System } from '@tron0/shared/interfaces/System';
import { PlayerInputTickRingBuffer } from '@tron0/shared/PlayerInputBuffer';
import PlayerSystem, { IsAlive } from '@tron0/shared/systems/PlayerSystem';
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

/** Wall-clock milliseconds between bot rotations when enabled. Used to derive tick interval from referenceTickTimeMs. */
const BOT_ROTATION_INTERVAL_MS = 10_000;

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

  /**
   * @param rotationIntervalMs  Rotation delay in ms (derived from reference tick time in init).
   *                            Pass 0 or negative to disable bot rotation entirely.
   *                            Defaults to BOT_ROTATION_INTERVAL_MS (toggleable for join/leave testing).
   */
  constructor(rotationIntervalMs: number = BOT_ROTATION_INTERVAL_MS) {
    super();
    this.rotationIntervalMs = rotationIntervalMs > 0 ? rotationIntervalMs : 0;
    this.rotationEnabled = this.rotationIntervalMs > 0;
  }

  private inputBuffer: PlayerInputTickRingBuffer | null = null;
  private lastActionTick = new Map<string, number>();
  private cooldownUntilTick = new Map<string, number>();
  private actionCooldownTicks = BOT_AI_BUDGET.ACTION_COOLDOWN_TICKS;

  /** Active bot playerIds (stable identifiers across entity create/remove for rotation testing). */
  private botPlayerIds: string[] = [];
  /** Bot AI state keyed by playerId (not eid, because rotation removes/recreates entities). */
  private brains = new Map<string, BotBrain>();
  private botCounter = BOT_COUNT;

  /** Whether periodic bot rotation (join/leave churn) is enabled. */
  private rotationEnabled: boolean;
  /** Configured rotation delay in ms (from constructor). */
  private rotationIntervalMs: number;
  /** Ticks between bot rotations (computed in init from referenceTickTimeMs). */
  private rotationIntervalTicks = 0;
  private nextRotationTick = 0;

  private room!: ECSGameRoom;

  getComponents(): object[] {
    return [];
  }

  /** Returns the number of managed bots currently participating in the simulation (always 3 under rotation). */
  getBotCount(): number {
    return this.botPlayerIds.length;
  }

  init(ctx: SimulationContext): void {
    this.room = ctx as ECSGameRoom;

    for (let i = 1; i <= BOT_COUNT; i++) {
      const botId = `bot${i}`;
      // Initial bots are created directly (pre-tick). Rotation will use the full PlayerJoined/Left/Spawn event path.
      PlayerSystem.createPlayer(this.room, botId);
      PlayerSystem.spawnPlayer(this.room, botId, this.room.tick);
      const eid = PlayerSystem.getPlayerEidByStringId(this.room, botId);
      if (eid === null) {
        logger.error('Failed to create bot', botId);
        continue;
      }
      const strategy = randomStrategy();
      this.botPlayerIds.push(botId);
      this.brains.set(botId, new BotBrain(strategy));
      logger.info(`Bot initialized: ${randomName(strategy)} (Strategy: ${strategy})`);
    }

    // Schedule periodic bot rotation (if enabled) to exercise Player join/leave flow.
    // Interval derived from referenceTickTimeMs so it is stable w.r.t. simulated time.
    if (this.rotationEnabled) {
      this.rotationIntervalTicks = Math.max(
        1,
        Math.floor(this.rotationIntervalMs / this.room.clock.referenceTickTimeMs)
      );
      this.nextRotationTick = this.room.tick + this.rotationIntervalTicks;
      logger.info(
        `Bot rotation enabled: interval=${this.rotationIntervalTicks} ticks (~${(this.rotationIntervalMs / 1000).toFixed(0)}s @ ${this.room.clock.referenceTickTimeMs.toFixed(2)}ms/tick)`
      );
    } else {
      this.rotationIntervalTicks = 0;
      logger.info('Bot rotation disabled');
    }
  }

  setInputBuffer(buffer: PlayerInputTickRingBuffer): void {
    this.inputBuffer = buffer;
  }

  update(getInput?: inputGetter, _getEvents?: eventGetter): void {
    if (!this.inputBuffer) return;

    const tick = this.room.tick;

    // --- Bot rotation (join/leave churn for testing the player flow) ---
    if (this.rotationEnabled && this.rotationIntervalTicks > 0 && tick >= this.nextRotationTick) {
      this.performBotRotation();
      this.nextRotationTick = tick + this.rotationIntervalTicks;
    }

    const degradationLevel = resolveDegradationLevel(this.room.ticksInBatch ?? 1);

    for (const playerId of this.botPlayerIds) {
      const eid = PlayerSystem.getPlayerEidByStringId(this.room, playerId);
      if (eid === null) {
        // Entity not materialized yet (e.g. just joined via event this tick); will be ready next tick.
        continue;
      }
      if (!IsAlive[eid]) {
        this.brains.get(playerId)?.memory.reset();
        this.room.addEvent({
          type: GameEventType.PlayerSpawn,
          tick,
          playerId,
        });
        continue;
      }

      if (this.shouldSkipInput(playerId, tick, getInput)) continue;

      const brain = this.brains.get(playerId);
      if (!brain) continue;

      const t0 = performance.now();
      const decision = brain.decide(this.room, eid, tick, { degradationLevel });
      const elapsed = performance.now() - t0;

      if (decision) {
        logger.debug('bot decision', {
          playerId,
          eid,
          mode: decision.mode,
          inputs: decision.inputs.length,
          ms: elapsed.toFixed(2),
          degraded: degradationLevel,
        });

        for (const input of decision.inputs) {
          this.room.addInput({ tick: input.tick, playerId, break: false, turn: input.turn });
        }
        this.lastActionTick.set(playerId, tick);
        if (decision.cooldownUntilTick !== undefined) {
          this.cooldownUntilTick.set(playerId, decision.cooldownUntilTick);
        }
      }
    }
  }

  /** Independent checks: pre-queued input, standard cooldown, extended TRAPPER cooldown. */
  private shouldSkipInput(playerId: string, tick: number, getInput?: inputGetter): boolean {
    if (getInput?.(playerId)?.turn) return true;

    const lastTick = this.lastActionTick.get(playerId) ?? 0;
    if (tick - lastTick < this.actionCooldownTicks) return true;

    const until = this.cooldownUntilTick.get(playerId);
    if (until !== undefined && tick < until) return true;

    return false;
  }

  /**
   * Replace one random active bot with a newly generated bot.
   * Emits PlayerLeft for the departing bot and PlayerJoined + PlayerSpawn for the arrival.
   * This exercises the canonical join/leave paths through PlayerSystem and event observers (chat, network).
   */
  private performBotRotation(): void {
    if (this.botPlayerIds.length === 0) return;

    const idx = Math.floor(Math.random() * this.botPlayerIds.length);
    const leavingId = this.botPlayerIds[idx];

    // Remove from active set and drop all per-bot state.
    this.botPlayerIds.splice(idx, 1);
    this.brains.delete(leavingId);
    this.lastActionTick.delete(leavingId);
    this.cooldownUntilTick.delete(leavingId);

    const tick = this.room.tick;
    this.room.addEvent({ type: GameEventType.PlayerLeft, tick: tick + 1, playerId: leavingId });

    // Fresh bot id and brain.
    this.botCounter += 1;
    const joiningId = `bot${this.botCounter}`;
    const strategy = randomStrategy();
    this.botPlayerIds.push(joiningId);
    this.brains.set(joiningId, new BotBrain(strategy));

    // Emit full join flow so PlayerSystem create + spawn run, and observers (chat, net) see the events.
    this.room.addEvent({ type: GameEventType.PlayerJoined, tick: tick + 1, playerId: joiningId });
    this.room.addEvent({ type: GameEventType.PlayerSpawn, tick: tick + 2, playerId: joiningId });

    logger.info(`Bot rotation: ${leavingId} left → ${joiningId} "${randomName(strategy)}" (${strategy}) joined`);
  }
}
