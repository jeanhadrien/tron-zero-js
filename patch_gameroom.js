const fs = require('fs');
const file = 'src/shared/GameRoom.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  /const ticksToProcess = this\.clock\.update\(deltaTime\);\s*const allPlayers = Array\.from\(this\.players\.values\(\)\);\s*for \(let index = 0; index < ticksToProcess; index\+\+\) \{/,
  `const ticksToProcess = this.clock.update(deltaTime);
    const startTick = this.clock.tick - ticksToProcess + 1;

    const allPlayers = Array.from(this.players.values());
    for (let index = 0; index < ticksToProcess; index++) {
      const currentSimTick = startTick + index;`
);

code = code.replace(
  /p\.update\(this\.clock\.tick, allPlayers, this\.area\);/g,
  `p.update(currentSimTick, allPlayers, this.area);`
);

fs.writeFileSync(file, code);
