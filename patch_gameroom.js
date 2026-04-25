const fs = require('fs');
const file = 'src/shared/GameRoom.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  'constructor(bus: GameEventBus, area: GameArea, clock: GameClock) {',
  'isServer: boolean;\n\n  constructor(bus: GameEventBus, area: GameArea, clock: GameClock, isServer: boolean = false) {\n    this.isServer = isServer;'
);

code = code.replace(
  'if (p.isRunning == false) {\n          this.spawnPlayer(p);\n        }',
  'if (this.isServer && p.isRunning == false) {\n          this.spawnPlayer(p);\n        }'
);

fs.writeFileSync(file, code);
