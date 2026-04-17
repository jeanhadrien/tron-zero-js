import { EventBus } from "../EventBus";

export default class DebugHud {
    scene: Phaser.Scene;
    values: Array<[string, any, string]> = [];

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
            // Format number to 2 decimal places if it's a number to avoid long decimals
            let valueString = "";
            if (typeof val === 'number') {
                valueString = val.toFixed(2);
            } else if (Array.isArray(val)) {
                valueString = `[${val.map(v => typeof v === 'number' ? v.toFixed(4) : v).join(', ')}]`;
            } else if (typeof val === 'object') {
                valueString = JSON.stringify(val);
            } else {
                valueString = String(val);
            }
            return { name, value: valueString };
        });
    }

    update(_delta: number) {
        EventBus.emit('debug-update', this.getStructuredData());
    }
}
