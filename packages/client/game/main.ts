import '../telemetry';
import { GameScene } from './scenes/GameScene';
import 'phaser';
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('tron-zero-client');

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,

  parent: 'game-container',
  pixelArt: true,
  backgroundColor: '#275b5bff',
  render: {
    roundPixels: false,
  },
  fps: {
    target: 200,
    smoothStep: false,
  },
  //   physics: {
  //     default: 'arcade',
  //     arcade: {
  //       gravity: { x: 0, y: 0 },
  //       fps: 240,
  //     },
  //   },
  scene: [GameScene],
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: '100%',
    height: '100%',
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
};

const StartGame = (parent: string) => {
  const span = tracer.startSpan('game.init');
  const game = new Phaser.Game({ ...config, parent });
  span.end();
  return game;
};

export default StartGame;
