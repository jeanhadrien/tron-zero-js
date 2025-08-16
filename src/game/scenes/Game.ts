import { Scene } from 'phaser';
import { EventBus } from '../EventBus';
import Player from '../gameobjects/Player';

export class GameScene extends Scene {
  PLAYER_COLOR: number = 0x00ff00;
  CANVAS_WIDTH: number = 900;
  CANVAS_HEIGHT: number = 600;
  MOVE_ANGLE: number = Math.PI / 2;

  isKeyDown: Record<string, boolean>;
  gridGraphics: Phaser.GameObjects.Graphics;
  player: Player;
  safeDistance: number;
  isAlive: boolean;
  gameOverText: Phaser.GameObjects.Text;
  restartText: Phaser.GameObjects.Text;
  spaceKey: Phaser.Input.Keyboard.Key;

  constructor() {
    super('Game');
  }

  preload() {
    this.load.setPath('assets');
  }

  create() {
    this.drawGridOnce();

    this.player = new Player(this, 400, 300, -Math.PI / 2);
    this.add.existing(this.player);

    let bounds = this.physics.world.setBounds(
      0,
      0,
      this.CANVAS_WIDTH,
      this.CANVAS_HEIGHT
    );
    this.physics.world.setBoundsCollision();
    this.player.setCollideWorldBounds(true);

    let v = this.physics.add.staticBody(200, 200, 300, 30);
    this.physics.add.collider(this.player, v, () => {
      this.player.persistTrail();
    });

    // Game state
    this.isAlive = true;

    // Controls
    this.isKeyDown = {};

    // Game Over text (hidden initially)
    this.gameOverText = this.add
      .text(this.CANVAS_WIDTH / 2, this.CANVAS_HEIGHT / 2 - 30, 'GAME OVER', {
        fontSize: '48px',
        fill: '#ff0000',
        fontFamily: 'Arial',
      })
      .setOrigin(0.5)
      .setVisible(false);

    this.restartText = this.add
      .text(
        this.CANVAS_WIDTH / 2,
        this.CANVAS_HEIGHT / 2 + 30,
        'Press SPACE to restart',
        {
          fontSize: '24px',
          fill: '#ffffff',
          fontFamily: 'Courier New',
        }
      )
      .setOrigin(0.5)
      .setVisible(false);

    // Add space key for restart
    this.spaceKey = this.input.keyboard.addKey(
      Phaser.Input.Keyboard.KeyCodes.SPACE
    );

    const leftKeys = ['Q', 'S', 'D', 'LEFT'];
    const rightKeys = ['K', 'L', 'M', 'RIGHT'];

    for (let i = 0; i < leftKeys.length; i++) {
      this.input.keyboard?.on(`keydown-${leftKeys[i]}`, () => {
        if (this.isKeyDown[leftKeys[i]]) {
          return;
        }
        this.isKeyDown[leftKeys[i]] = true;
        this.player.rotate('left');
      });
      this.input.keyboard?.on(`keydown-${rightKeys[i]}`, () => {
        if (this.isKeyDown[rightKeys[i]]) {
          return;
        }
        this.isKeyDown[rightKeys[i]] = true;
        this.player.rotate('right');
      });
      this.input.keyboard?.on(
        `keyup-${leftKeys[i]}`,
        () => (this.isKeyDown[leftKeys[i]] = false)
      );
      this.input.keyboard?.on(
        `keyup-${rightKeys[i]}`,
        () => (this.isKeyDown[rightKeys[i]] = false)
      );
    }
  }

  update(_time: any, delta: number) {
    if (!this.isAlive) {
      // Check for restart
      if (this.spaceKey.isDown) {
        this.restartGame();
      }
      return;
    }

    this.player.update(delta);

    // Check boundary collision
    if (
      this.player.x < 0 ||
      this.player.x > this.CANVAS_WIDTH ||
      this.player.y < 0 ||
      this.player.y > this.CANVAS_HEIGHT
    ) {
      this.gameOver();
      return;
    }
  }

  releaseKey(key: string) {
    this.isKeyDown[key] = false;
  }

  gameOver() {
    this.isAlive = false;
    this.gameOverText.setVisible(true);
    this.restartText.setVisible(true);

    // Optional: Add a death effect
    this.player.driverGraphics.fillStyle(0xff0000); // Turn triangle red
  }

  drawGridOnce() {
    this.gridGraphics = this.add.graphics();
    this.gridGraphics.lineStyle(1, 0x333333, 0.5); // Grey lines with 50% opacity

    const gridSize = 40; // Space between grid lines

    // Draw vertical lines
    for (let x = 0; x <= this.CANVAS_WIDTH; x += gridSize) {
      this.gridGraphics.moveTo(x, 0);
      this.gridGraphics.lineTo(x, this.CANVAS_HEIGHT);
    }

    // Draw horizontal lines
    for (let y = 0; y <= this.CANVAS_HEIGHT; y += gridSize) {
      this.gridGraphics.moveTo(0, y);
      this.gridGraphics.lineTo(this.CANVAS_WIDTH, y);
    }
    this.gridGraphics.strokePath();

    // Send grid to back so it appears behind other elements
    this.gridGraphics.setDepth(-1);
  }

  restartGame() {
    // Reset all game state
    this.isAlive = true;
    this.player.x = 400;
    this.player.y = 500;
    this.player.direction = 0;
    this.player.driverGraphics.rotation = this.player.direction + Math.PI / 2;
    this.player.trailPoints = [];
    this.player.trailGraphics.clear();

    // Hide game over text
    this.gameOverText.setVisible(false);
    this.restartText.setVisible(false);

    // Reset key states
    this.isKeyDown = {};
  }
}
