import { Game as MainGame } from './scenes/Game';
import 'phaser';

// Find out more information about the Game Config at:
// https://docs.phaser.io/api-documentation/typedef/types-core#gameconfig
const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.CANVAS,

    parent: 'game-container',
    pixelArt: true,
    backgroundColor: '#275b5bff',
    physics: {
        default: "arcade",
        arcade: {
            gravity: { x: 0, y: 0 },
            fps: 240,
            debug: true
        }
    },
    scene: [
        MainGame
    ],
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH
    },
};

const StartGame = (parent: string) => {
    return new Phaser.Game({ ...config, parent });
}

export default StartGame;
