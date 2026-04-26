import 'jsdom-global/register';
import * as Phaser from 'phaser';

const l2 = new Phaser.Geom.Line(100, 0, 100, 100); // Current player line (from top to bottom)
const detFront = new Phaser.Geom.Line(100, 100, 100, 200); // detection line front (from top to bottom)

let out = new Phaser.Geom.Point();
let intersect = Phaser.Geom.Intersects.LineToLine(detFront, l2, out);
console.log("Collinear forward intersection:", intersect, out);
