import TestVisualizerScene from './scenes/TestVisualizerScene';
import type { PlayerDTO } from '../../shared/Player';

export default function StartVisualizer(parent: string, ticks: PlayerDTO[][]) {
  TestVisualizerScene.pendingTicks = ticks;

  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#1a1a2e',
    scene: [TestVisualizerScene],
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: '100%',
      height: '100%',
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
  });
}
