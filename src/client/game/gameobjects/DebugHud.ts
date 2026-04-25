import { EventBus } from '../EventBus';

export default class DebugHud {
  scene: Phaser.Scene;
  values: Array<[string, any, string]> = [];
  private lastUpdate = 0;
  private readonly UPDATE_RATE = 80; // ms (~12 Hz)

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  add(name: string, debugVar: any, property: string) {
    this.values.push([name, debugVar, property]);
  }

  getStructuredData() {
    if (!this.values) return [];
    return this.values.map(([name, debugVar, property]) => {
      const val = debugVar[property];
      let valueString = '';
      if (typeof val === 'number') {
        valueString = val.toFixed(2);
      } else if (Array.isArray(val)) {
        valueString = `[${val.map((v) => (typeof v === 'number' ? v.toFixed(4) : v)).join(', ')}]`;
      } else if (typeof val === 'object') {
        valueString = JSON.stringify(val);
      } else {
        valueString = String(val);
      }
      return { name, value: valueString };
    });
  }

  update(time: number) {
    if (time - this.lastUpdate < this.UPDATE_RATE) return;
    this.lastUpdate = time;
    EventBus.emit('debug-update', this.getStructuredData());
  }
}
