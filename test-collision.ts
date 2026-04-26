import 'jsdom-global/register';
import * as Phaser from 'phaser';

const l1 = new Phaser.Geom.Line(0, 0, 100, 0); // Previous line (from left to right)
const l2 = new Phaser.Geom.Line(100, 0, 100, 100); // Current player line (from top to bottom)
const detRight = new Phaser.Geom.Line(100, 0, 0, 0); // detection line right (from right to left)

let out = new Phaser.Geom.Point();
let intersect = Phaser.Geom.Intersects.LineToLine(detRight, l1, out);
console.log("Collinear overlap intersection:", intersect, out);

const detLeft = new Phaser.Geom.Line(100, 0, 200, 0); // detection line left (from left to right)
intersect = Phaser.Geom.Intersects.LineToLine(detLeft, l1, out);
console.log("Collinear endpoint share intersection:", intersect, out);

