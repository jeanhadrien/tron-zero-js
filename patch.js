const fs = require('fs');
const file = 'src/client/game/scenes/GameScene.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(/this\.gameClock\.update\(delta\);\s*for \(let i = 0; i < ticksToProcess; i\+\+\) \{\s*if \(this\.gameClock\.tick > 0\) \{/g,
  `this.gameClock.update(delta);
    const startTick = this.gameClock.tick - ticksToProcess + 1;
    for (let i = 0; i < ticksToProcess; i++) {
      const currentSimTick = startTick + i;
      if (currentSimTick > 0) {`
);

code = code.replace(/p\.update\(\s*this\.gameClock\.tick,\s*this\.gameRoom\.getAllPlayers\(\),\s*this\.gameArea\s*\);/g,
  `p.update(
              currentSimTick,
              this.gameRoom.getAllPlayers(),
              this.gameArea
            );`
);

fs.writeFileSync(file, code);
