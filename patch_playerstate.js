const fs = require('fs');
const file = 'src/shared/PlayerState.ts';
let code = fs.readFileSync(file, 'utf8');

const target = 'this.trail.load(playerDto.trail);';
const replacement = 'this.trail.load(playerDto.trail);\n    this.currentLine.setTo(this.x, this.y, this.x, this.y);\n    this.previousLineEnd.set(this.x, this.y);';

code = code.replace(target, replacement);

fs.writeFileSync(file, code);
