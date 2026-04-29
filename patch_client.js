const fs = require('fs');
let code = fs.readFileSync('src/client/game/network/NetworkClient.ts', 'utf8');

if (!code.includes('iceServers: [')) {
  code = code.replace(
    'url: `${window.location.protocol}//${window.location.hostname}`,',
    `url: \`\${window.location.protocol}//\${window.location.hostname}\`,
      iceServers: [
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ],`
  );
  fs.writeFileSync('src/client/game/network/NetworkClient.ts', code);
  console.log('Patched NetworkClient.ts');
} else {
  console.log('NetworkClient.ts already has iceServers');
}
