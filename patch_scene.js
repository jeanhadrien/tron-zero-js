const fs = require('fs');
const file = 'src/client/game/scenes/GameScene.ts';
let code = fs.readFileSync(file, 'utf8');

const target = /player\.trail\.fillTurn\(PlayerPoint\.fromDto\(turnPointDTO\)\);\s+this\.playerRenderers\.get\(player\.id\)!\._playTurnSound\(player\);/m;
const replacement = `const turnPoint = PlayerPoint.fromDto(turnPointDTO);
      player.trail.fillTurn(turnPoint);
      player.direction = turnPoint.direction;
      player.x = turnPoint.coordinates.x;
      player.y = turnPoint.coordinates.y;
      player.velocity = turnPoint.velocity;
      player.speedMult = turnPoint.speed;
      player._setSpeedAndVelocity(player.speedMult);
      
      player.currentTick = turnPoint.tick;
      const ticksBehind = this.gameClock.tick - turnPoint.tick;
      if (ticksBehind > 0) {
        const allPlayers = this.gameRoom.getAllPlayers();
        for (let i = 0; i < ticksBehind; i++) {
          player.update(turnPoint.tick + i + 1, allPlayers, this.gameArea);
        }
      }

      this.playerRenderers.get(player.id)!._playTurnSound(player);`;

code = code.replace(target, replacement);

fs.writeFileSync(file, code);
