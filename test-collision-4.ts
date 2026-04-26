import 'jsdom-global/register';
import * as Phaser from 'phaser';

const l1 = new Phaser.Geom.Line(0, 0, 100, 0); // Previous line

let detFront = new Phaser.Geom.Line(100, 0, 100, 2000); // Front detection line
let out = new Phaser.Geom.Point();
let intersect = Phaser.Geom.Intersects.LineToLine(detFront, l1, out);
console.log("Perpendicular intersection at endpoint:", intersect, out);

let detLeft = new Phaser.Geom.Line(100, 0, 2100, 0);
intersect = Phaser.Geom.Intersects.LineToLine(detLeft, l1, out);
console.log("Collinear left going right from endpoint:", intersect, out);

let detRight = new Phaser.Geom.Line(100, 0, -1900, 0);
intersect = Phaser.Geom.Intersects.LineToLine(detRight, l1, out);
console.log("Collinear right going left from endpoint:", intersect, out);
