
import GameArea from '../../../shared/GameArea';

export default class GameAreaRenderer {
    gridGraphics: Phaser.GameObjects.Graphics;
    scene: Phaser.Scene;
    gameArea: GameArea;

    constructor(scene: Phaser.Scene, gameArea: GameArea) {
        this.scene = scene;
        this.gameArea = gameArea;
    }

    draw() {
        this.gridGraphics = this.scene.add.graphics();
        this.gridGraphics.lineStyle(1, 0x333333, 0.5); // Grey lines with 50% opacity

        const gridSize = 40; // Space between grid lines

        // Draw vertical lines
        for (let x = 0; x <= this.gameArea.width; x += gridSize) {
            this.gridGraphics.moveTo(x, 0);
            this.gridGraphics.lineTo(x, this.gameArea.height);
        }

        // Draw horizontal lines
        for (let y = 0; y <= this.gameArea.height; y += gridSize) {
            this.gridGraphics.moveTo(0, y);
            this.gridGraphics.lineTo(this.gameArea.width, y);
        }
        this.gridGraphics.strokePath();

        // Send grid to back so it appears behind other elements
        this.gridGraphics.setDepth(-1);
    }

}
