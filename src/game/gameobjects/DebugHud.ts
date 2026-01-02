import { EventBus } from "../EventBus";


export default class DebugHud {
    scene: Phaser.Scene;
    values : Array<[String,any,string]> = [];
    textObject: Phaser.GameObjects.Text;
    textValue: String;
    
    constructor(scene: Phaser.Scene){
        this.scene = scene;
        this.textObject = this.scene.add.text(0,0, '', {
            fontSize: '16px',
            style: '#ffffffff',
            fontFamily: 'Arial',
        })
        .setVisible(true);
    }

    add( name: string, debugVar: any, property: string){
        this.values.push([name,debugVar,property])
    }

    formatArrayToString() {
        if (this.values) return this.values
            .map(([name, debugVar, property]) => {
            // Convert objects to JSON strings, otherwise use standard string conversion
            const val = debugVar[property];
            const valueString = typeof val === 'object' ? JSON.stringify(val) : String(val);
            return `${name}: ${valueString}`;
            })
            .join(", "); // Separates each pair with a comma and space
        else return "";
    }    
    


    update(delta: number){
        this.textObject.setText(this.formatArrayToString());
    }

}