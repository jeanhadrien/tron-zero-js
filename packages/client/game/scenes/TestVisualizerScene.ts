import 'phaser';
import { EventBus } from '../EventBus';
import type { PlayerDTO } from '@tron0/shared/Player';
import PlayerRenderer, { RenderSnapshot } from '../gameobjects/PlayerRenderer';

const GRID_SIZE = 40;
const GRID_COLOR = 0x333333;
const ARENA_SIZE = 1000;

export default class TestVisualizerScene extends Phaser.Scene {
  static pendingTicks: PlayerDTO[][] | null = null;

  private ticks: PlayerDTO[][] = [];
  private tickIndex = 0;
  private isPlaying = false;
  private tickTime = 0;
  private msPerTick = 100;

  private playerRenderers = new Map<string, PlayerRenderer>();
  private tickText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;

  private cursorKeys!: Phaser.Types.Input.Keyboard.CursorKeys;
  private spaceKey!: Phaser.Input.Keyboard.Key;

  constructor() {
    super({ key: 'TestVisualizer' });
  }

  init() {
    if (TestVisualizerScene.pendingTicks) {
      this.ticks = TestVisualizerScene.pendingTicks;
      TestVisualizerScene.pendingTicks = null;
    }
    this.tickIndex = 0;
    this.isPlaying = true;
    this.tickTime = 0;
  }

  create() {
    this.cameras.main.setBackgroundColor('#1a1a2e');
    this.cameras.main.setBounds(0, 0, ARENA_SIZE, ARENA_SIZE);

    const zoomX = this.scale.width / ARENA_SIZE;
    const zoomY = this.scale.height / ARENA_SIZE;
    this.cameras.main.setZoom(Math.min(zoomX, zoomY));
    this.cameras.main.centerOn(ARENA_SIZE / 2, ARENA_SIZE / 2);

    this.scale.on('resize', () => {
      const zx = this.scale.width / ARENA_SIZE;
      const zy = this.scale.height / ARENA_SIZE;
      this.cameras.main.setZoom(Math.min(zx, zy));
      this.cameras.main.centerOn(ARENA_SIZE / 2, ARENA_SIZE / 2);
    });

    this.drawGrid();
    this.createHUD();

    this.cursorKeys = this.input.keyboard!.createCursorKeys();
    this.spaceKey = this.input.keyboard!.addKey(
      Phaser.Input.Keyboard.KeyCodes.SPACE
    );

    this.listenToEventBus();

    if (this.ticks.length > 0) {
      this.renderTick(this.tickIndex);
      this.emitStatus();
    }
  }

  update(_time: number, delta: number) {
    if (!this.isPlaying) {
      this.handleKeyboard();
      return;
    }

    this.tickTime += delta;
    while (this.tickTime >= this.msPerTick) {
      this.tickTime -= this.msPerTick;

      if (this.tickIndex < this.ticks.length - 1) {
        this.tickIndex++;
        this.renderTick(this.tickIndex);
        this.emitStatus();
      } else {
        this.isPlaying = false;
        this.emitStatus();
        break;
      }
    }

    this.updateHUD();
    this.handleKeyboard();
  }

  private listenToEventBus() {
    EventBus.on('visualizer-play', this.onPlay, this);
    EventBus.on('visualizer-pause', this.onPause, this);
    EventBus.on('visualizer-toggle', this.onToggle, this);
    EventBus.on('visualizer-step-fwd', this.onStepFwd, this);
    EventBus.on('visualizer-step-back', this.onStepBack, this);
    EventBus.on('visualizer-seek', this.onSeek, this);
    EventBus.on('visualizer-speed', this.onSetSpeed, this);

    this.events.on('shutdown', () => {
      EventBus.off('visualizer-play', this.onPlay, this);
      EventBus.off('visualizer-pause', this.onPause, this);
      EventBus.off('visualizer-toggle', this.onToggle, this);
      EventBus.off('visualizer-step-fwd', this.onStepFwd, this);
      EventBus.off('visualizer-step-back', this.onStepBack, this);
      EventBus.off('visualizer-seek', this.onSeek, this);
      EventBus.off('visualizer-speed', this.onSetSpeed, this);
    });
  }

  private onPlay = () => {
    this.isPlaying = true;
    this.emitStatus();
  };
  private onPause = () => {
    this.isPlaying = false;
    this.emitStatus();
  };
  private onToggle = () => {
    this.isPlaying = !this.isPlaying;
    this.emitStatus();
  };

  private onStepFwd = () => {
    this.isPlaying = false;
    if (this.tickIndex < this.ticks.length - 1) {
      this.tickIndex++;
      this.renderTick(this.tickIndex);
      this.emitStatus();
    }
  };

  private onStepBack = () => {
    this.isPlaying = false;
    if (this.tickIndex > 0) {
      this.tickIndex--;
      this.renderTick(this.tickIndex);
      this.emitStatus();
    }
  };

  private onSeek = (index: number) => {
    this.isPlaying = false;
    this.tickIndex = Phaser.Math.Clamp(index, 0, this.ticks.length - 1);
    this.renderTick(this.tickIndex);
    this.emitStatus();
  };

  private onSetSpeed = (ms: number) => {
    this.msPerTick = Phaser.Math.Clamp(ms, 16, 500);
    this.emitStatus();
  };

  private handleKeyboard() {
    if (Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
      this.isPlaying = !this.isPlaying;
      this.emitStatus();
    }
    if (Phaser.Input.Keyboard.JustDown(this.cursorKeys.right)) {
      this.onStepFwd();
    }
    if (Phaser.Input.Keyboard.JustDown(this.cursorKeys.left)) {
      this.onStepBack();
    }
    if (Phaser.Input.Keyboard.JustDown(this.cursorKeys.up)) {
      this.msPerTick = Math.max(16, this.msPerTick - 50);
      this.emitStatus();
    }
    if (Phaser.Input.Keyboard.JustDown(this.cursorKeys.down)) {
      this.msPerTick = Math.min(500, this.msPerTick + 50);
      this.emitStatus();
    }
    this.updateHUD();
  }

  private emitStatus() {
    EventBus.emit('visualizer-update', {
      index: this.tickIndex,
      total: this.ticks.length,
      playing: this.isPlaying,
      speed: Math.round(100 / this.msPerTick),
    });
  }

  private drawGrid() {
    const gfx = this.add.graphics();
    gfx.lineStyle(1, GRID_COLOR, 0.5);
    gfx.setDepth(-1);

    for (let x = 0; x <= ARENA_SIZE; x += GRID_SIZE) {
      gfx.moveTo(x, 0);
      gfx.lineTo(x, ARENA_SIZE);
    }
    for (let y = 0; y <= ARENA_SIZE; y += GRID_SIZE) {
      gfx.moveTo(0, y);
      gfx.lineTo(ARENA_SIZE, y);
    }
    gfx.strokePath();
  }

  private ensurePlayer(id: string) {
    let renderer = this.playerRenderers.get(id);

    if (!renderer) {
      renderer = new PlayerRenderer(this, -1, null as any);
      this.playerRenderers.set(id, renderer);
    }

    return { renderer };
  }

  private renderTick(index: number) {
    const tick = this.ticks[index];
    const activePlayers = new Set<string>();

    for (const dto of tick) {
      activePlayers.add(dto.id);
      const { renderer } = this.ensurePlayer(dto.id);

      const snapshot: RenderSnapshot = {
        tick: index,
        x: dto.x,
        y: dto.y,
        direction: dto.direction,
        color: dto.color,
        speedMult: dto.speedMult,
        rubber: dto.rubber,
        isAlive: dto.isAlive,
        trailLength: dto.trail?.length ?? 0,
        trailXs: dto.trail?.map((p: any) => p.coordinates?.x ?? p.x) ?? [],
        trailYs: dto.trail?.map((p: any) => p.coordinates?.y ?? p.y) ?? [],
      };

      renderer.renderAt(snapshot);
    }

    for (const [id, renderer] of this.playerRenderers) {
      if (!activePlayers.has(id)) {
        renderer.setVisible(false);
      }
    }
  }

  private createHUD() {
    const style: Phaser.Types.GameObjects.Text.TextStyle = {
      fontSize: '14px',
      color: '#00ff00',
      fontFamily: 'Courier New',
    };

    this.tickText = this.add
      .text(10, 5, '', style)
      .setScrollFactor(0)
      .setDepth(100);

    this.hintText = this.add
      .text(10, 22, '', {
        ...style,
        fontSize: '11px',
        color: '#888888',
      })
      .setScrollFactor(0)
      .setDepth(100);
  }

  private updateHUD() {
    const speed = Math.round(100 / this.msPerTick);
    this.tickText.setText(
      `Tick: ${this.tickIndex + 1} / ${this.ticks.length}  [${this.isPlaying ? '▶' : '⏸'}]  ${speed}x`
    );
    this.hintText.setText('Space: play/pause | ←→: step | ↑↓: speed');
  }
}
