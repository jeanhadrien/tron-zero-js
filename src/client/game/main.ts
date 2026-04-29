import { GameScene } from './scenes/GameScene';
import 'phaser';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,

  parent: 'game-container',
  pixelArt: true,
  backgroundColor: '#275b5bff',
  render: {
    roundPixels: false,
  },
  fps: {
    target: 60,
    smoothStep: true,
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      fps: 240,
    },
  },
  scene: [GameScene],
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: '100%',
    height: '100%',
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};

const StartGame = (parent: string) => {
  return new Phaser.Game({ ...config, parent });
};

export default StartGame;

