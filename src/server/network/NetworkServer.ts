import { ServerChannel } from '@geckos.io/server';
import GameRoom from '../../shared/GameRoom';
import GameClock from '../../shared/GameClock';
import { PlayerPoint } from '../../shared/PlayerPoint';
import PlayerState from '../../shared/PlayerState';

export class NetworkServer {
  io: any;
  gameRoom: GameRoom;
  gameClock: GameClock;

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
      console.log(`Player connected: ${playerId}`);

      // Keep track of which turn ticks we've already processed for this client
      const processedTurnTicks = new Set<number>();

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

      // Send new player to other clients
      channel.broadcast.emit(
        'player_joined',
        {
          tick: this.gameClock.tick,
          id: playerId,
          state: this.gameRoom.getPlayer(playerId).serialize(),
        },
        { reliable: true }
      );

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
          if (processedTurnTicks.has(turn.tick)) {
            continue;
          }

          // Clamp extreme future turns to a reasonable future offset to prevent
          // time paradoxes and memory leaks from malicious clients.
          // A client shouldn't be more than 20 ticks (333ms) ahead of the server.
          const MAX_FUTURE_OFFSET = 20;
          if (turn.tick > this.gameClock.tick + MAX_FUTURE_OFFSET) {
            console.warn(
              `Received a turn too far in the future (${turn.tick} vs ${this.gameClock.tick}), clamping to max offset`
            );
            turn.tick = this.gameClock.tick + MAX_FUTURE_OFFSET;
          }

          processedTurnTicks.add(turn.tick);
          newTurns.push(turn);
        }

        if (newTurns.length === 0) {
          return; // No new turns to process
        }

        // Prune old ticks to prevent memory leak
        const oldestAllowedTick = this.gameClock.tick - 100;
        for (const tick of processedTurnTicks) {
          if (tick < oldestAllowedTick) {
            processedTurnTicks.delete(tick);
          }
        }

        // Server must also simulate the player turning and fast forward them
        try {
          // Send the array of newly discovered turns to be reconciled in a single pass
          manager.reconcileTurns(
            newTurns,
            this.gameClock,
            this.gameRoom.area,
            allManagers
          );

          // Broadcast the newly processed turn points
          for (const turn of newTurns) {
            this.gameRoom.playerEventBus.emit('player_turn', localPlayer, turn);
          }
        } catch (e) {
          console.warn(`Failed to apply client turns from ${playerId}: ${e}`);
        }
      });

      // Handle manual respawn requests from clients
      channel.on('respawn', () => {
        if (!localPlayer.isRunning) {
          this.gameRoom.spawnPlayer(localPlayer);
        }
      });

      channel.onDisconnect(() => {
        console.log(`Player disconnected: ${playerId}`);
        this.gameRoom.removePlayerById(playerId);
        this.io.emit('player_left', { id: playerId }, { reliable: true });
      });
    });

    this.gameRoom.playerEventBus.on('player_turn', (player, turnPoint) => {
      this.io.emit('player_turn', [player.id, turnPoint.serialize()], {
        reliable: true,
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

    this.gameRoom.bus.on('game_add_player', (player: PlayerState) => {
      this.io.emit('game_add_player', [player.id, player.serialize()], {
        reliable: true,
      });
    });

    this.gameRoom.bus.on('game_remove_player', (player: PlayerState) => {
      this.io.emit('game_remove_player', [player.id], {
        reliable: true,
      });
    });

    // Periodically broadcast sync state to fix minor drift on clients
    setInterval(() => {
      this.io.emit(
        'sync_state',
        [this.gameClock.tick, this.gameRoom.getState()],
        { reliable: false }
      );
    }, 1000);
  }
}
