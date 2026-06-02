import type { Scene } from 'phaser';

export default class DebugHud {
  /** [name, value getter] tuples registered via add() */
  values: Array<[string, () => any]> = [];
  private text: Phaser.GameObjects.Text;
  private lastUpdate = 0;
  private readonly UPDATE_RATE = 80; // ms (~12 Hz)

  constructor(scene: Scene) {
    this.text = scene.add.text(10, 10, '', {
      fontSize: '14px',
      color: '#00ff00',
      fontFamily: 'monospace',
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      padding: { x: 10, y: 10 },
    });
    this.text.setScrollFactor(0);
    this.text.setDepth(1000);
  }

  /** Register a named debug value to display. */
  add(name: string, getter: () => any) {
    this.values.push([name, getter]);
  }

  /** Build a multiline text string from all registered values. */
  private _buildText(): string {
    const lines: string[] = ['Debug Console'];
    for (const [name, getter] of this.values) {
      const val = getter();
      let valueString: string;
      if (typeof val === 'number') {
        valueString = val.toFixed(2);
      } else if (Array.isArray(val)) {
        valueString = `[${val.map((v) => (typeof v === 'number' ? v.toFixed(4) : v)).join(', ')}]`;
      } else if (typeof val === 'object' && val !== null) {
        valueString = JSON.stringify(val);
      } else {
        valueString = String(val);
      }
      lines.push(`${name}: ${valueString}`);
    }
    return lines.join('\n');
  }

  /** Call every frame — updates the Phaser text object at the configured rate. */
  update(time: number) {
    if (time - this.lastUpdate < this.UPDATE_RATE) return;
    this.lastUpdate = time;
    this.text.setText(this._buildText());
  }
}
