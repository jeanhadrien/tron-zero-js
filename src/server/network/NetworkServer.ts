import { ServerChannel } from '@geckos.io/server';
import { trace } from '@opentelemetry/api';
import GameRoom from '../../shared/GameRoom';
import GameClock from '../../shared/GameClock';
import { PlayerPoint } from '../../shared/PlayerPoint';
import Player from '../../shared/Player';
import { TickRingBuffer } from '../../shared/TickRingBuffer';
import { Logger } from '../../shared/Logger';

const logger = new Logger('NET');
const tracer = trace.getTracer('tron-zero-server');

export class NetworkServer {
  io: any;
  gameRoom: GameRoom;
  gameClock: GameClock;

  private syncIndex = 0;
  private syncIntervalId: ReturnType<typeof setInterval> | null = null;
  private readonly PLAYER_SYNC_INTERVAL_MS = 10000;

  constructor(io: any, gameRoom: GameRoom, gameClock: GameClock) {
    this.io = io;
    this.gameRoom = gameRoom;
    this.gameClock = gameClock;

    this.setupListeners();
  }

  setupListeners() {
    // When a player connects
    this.io.onConnection((channel: ServerChannel) => {
      // His id is the channel id
      const playerId = channel.id!;

      const connectSpan = tracer.startSpan('player.connect');
      connectSpan.setAttribute('player.id', playerId);
      logger.info(`Player connected: ${playerId}`);

      // Keep track of which turn ticks we've already processed for this client
      const processedTurnTicks = new TickRingBuffer<boolean>(128);

      // Create player in the game room
      const localPlayer = this.gameRoom.createPlayerWithForcedId(playerId);

      channel.on('ping', (clientTime: any) => {
        channel.emit('pong', clientTime);
      });

      // Send current state of the game room to the client
      channel.emit(
        'init_state',
        [this.gameClock.tick, this.gameRoom.getState()],
        {
          reliable: true,
        }
      );

      connectSpan.end();

      // When client sends a turn (now an array of turns in a sliding window), update local state
      channel.on('client_turn', (data: any) => {
        const turnPointDTOs: any[] = Array.isArray(data) ? data : [data];
        const allManagers = Array.from(this.gameRoom.playerManagers.values());
        const manager = this.gameRoom.playerManagers.get(playerId);

        if (!manager) return;

        const newTurns: PlayerPoint[] = [];

        for (const turnPointDTO of turnPointDTOs) {
          const turn = PlayerPoint.fromDto(turnPointDTO);

          // Prevent processing the same turn tick twice
          if (processedTurnTicks.get(turn.tick, playerId) !== null) {
            continue;
          }

          // Clamp extreme future turns to a reasonable future offset to prevent
          // time paradoxes and memory leaks from malicious clients.
          // A client shouldn't be more than 20 ticks (333ms) ahead of the server.
          const MAX_FUTURE_OFFSET = 20;
          if (turn.tick > this.gameClock.tick + MAX_FUTURE_OFFSET) {
            logger.warn(
              `Received a turn too far in the future (${turn.tick} vs ${this.gameClock.tick}), clamping to max offset`
            );
            turn.tick = this.gameClock.tick + MAX_FUTURE_OFFSET;
          }

          processedTurnTicks.record(turn.tick, playerId, true);
          newTurns.push(turn);
        }

        if (newTurns.length === 0) {
          return; // No new turns to process
        }

        // Server must also simulate the player turning and fast forward them
        try {
          const turnSpan = tracer.startSpan('player.turn.process');
          turnSpan.setAttribute('player.id', playerId);
          turnSpan.setAttribute('tick', this.gameClock.tick);
          turnSpan.setAttribute('turn_count', newTurns.length);

          // Send the array of newly discovered turns to be reconciled in a single pass
          manager.reconcileTurns(newTurns, allManagers);

          turnSpan.end();

          // Broadcast the newly processed turn points
          for (const turn of newTurns) {
            this.gameRoom.playerEventBus.emit('player_turn', localPlayer, turn);
          }
        } catch (e) {
          logger.warn(`Failed to apply client turns from ${playerId}: ${e}`);
        }
      });

      // Handle manual respawn requests from clients
      channel.on('respawn', () => {
        if (!localPlayer.isAlive) {
          this.gameRoom.spawnPlayer(localPlayer);
        }
      });

      channel.onDisconnect(() => {
        const disconnectSpan = tracer.startSpan('player.disconnect');
        disconnectSpan.setAttribute('player.id', playerId);
        logger.info(`Player disconnected: ${playerId}`);
        this.gameRoom.removePlayerById(playerId);
        disconnectSpan.end();
      });
    });

    this.gameRoom.playerEventBus.on('player_turn', (player, turnPoint) => {
      this.io.emit('player_turn', [player.id, turnPoint.serialize()], {
        reliable: false,
      });
    });

    this.gameRoom.playerEventBus.on('player_spawn', (player) => {
      this.io.emit('player_spawn', [player.id, player.serialize()], {
        reliable: true,
      });
    });

    this.gameRoom.playerEventBus.on('player_death', (player) => {
      this.io.emit('player_death', [player.id, player.serialize()], {
        reliable: true,
      });
    });

    this.gameRoom.gameEventBus.on('game_add_player', (player: Player) => {
      this.io.emit('game_add_player', [player.id, player.serialize()], {
        reliable: true,
      });
      this.manageSyncCycle();
    });

    this.gameRoom.gameEventBus.on('game_remove_player', (player: Player) => {
      this.io.emit('game_remove_player', [player.id], {
        reliable: true,
      });
      this.manageSyncCycle();
    });
  }

  private manageSyncCycle() {
    if (this.syncIntervalId !== null) {
      clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }

    const playerCount = this.gameRoom.playerManagers.size;
    if (playerCount === 0) return;

    const intervalMs = this.PLAYER_SYNC_INTERVAL_MS / playerCount;

    this.syncIntervalId = setInterval(() => {
      const players = Array.from(this.gameRoom.playerManagers.entries());
      if (players.length === 0) return;

      this.syncIndex = this.syncIndex % players.length;
      const [playerId, manager] = players[this.syncIndex];

      const syncSpan = tracer.startSpan('state.sync');
      syncSpan.setAttribute('player.id', playerId);
      syncSpan.setAttribute('tick', this.gameClock.tick);
      syncSpan.setAttribute('player_count', players.length);

      this.io.emit(
        'sync_state',
        [this.gameClock.tick, playerId, manager.activeState.serialize()],
        { reliable: true }
      );

      syncSpan.end();

      this.syncIndex++;
    }, intervalMs);
  }
}
