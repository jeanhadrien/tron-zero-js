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

      // When client sends a turn, update local state
      channel.on('client_turn', (data: any) => {
        const [turnPointDTO] = data;
        const turn = PlayerPoint.fromDto(turnPointDTO);

        // Clamp future turns to the current server tick to prevent time paradoxes
        if (turn.tick > this.gameClock.tick) {
          console.warn('Received a turn in the future');
          turn.tick = this.gameClock.tick;
        }

        // Server must also simulate the player turning and fast forward them
        const allPlayers = this.gameRoom.getAllPlayers();
        try {
          localPlayer.applyRemoteTurn(
            turn,
            this.gameClock,
            this.gameRoom.area,
            allPlayers
          );
          // Broadcast the original turn point directly from the client.
          this.gameRoom.playerEventBus.emit(
            'player_turn',
            localPlayer,
            turn
          );
        } catch (e) {
          console.warn(`Failed to apply client turn from ${playerId}: ${e}`);
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
