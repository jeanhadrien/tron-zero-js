const fs = require('fs');
let code = fs.readFileSync('src/server/main.ts', 'utf8');

if (!code.includes('iceServers')) {
  code = code.replace(
    'portRange: {',
    `iceServers: [
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ],
  portRange: {`
  );
  fs.writeFileSync('src/server/main.ts', code);
  console.log('Patched main.ts');
} else {
  console.log('main.ts already has iceServers');
}
