const fs = require('fs');
const file = 'src/shared/PlayerState.ts';
let code = fs.readFileSync(file, 'utf8');

const target = 'this.isRunning = true;\n    this.turnQueue = [];';
const replacement = 'this.isRunning = true;\n    this.shouldHandleDeath = true;\n    this.turnQueue = [];';

code = code.replace(target, replacement);

fs.writeFileSync(file, code);
