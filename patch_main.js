const fs = require('fs');
const file = 'src/server/main.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  'const gameRoom = new GameRoom(gameBus, gameArea, gameClock);',
  'const gameRoom = new GameRoom(gameBus, gameArea, gameClock, true);'
);

fs.writeFileSync(file, code);
