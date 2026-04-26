import 'jsdom-global/register';
import * as Phaser from 'phaser';

const l1 = new Phaser.Geom.Line(0, 0, 100, 0); // Previous line

let x = 100;
let y = 1;
const lookAheadLength = 2000;
let direction = Math.PI / 2; // DOWN

// Left detection line goes LEFT. But wait, direction - PI/2 is 0.
let detLeft = new Phaser.Geom.Line();
Phaser.Geom.Line.SetToAngle(detLeft, x, y, direction - Math.PI / 2, lookAheadLength);
console.log("detLeft:", detLeft);

let out = new Phaser.Geom.Point();
let intersect = Phaser.Geom.Intersects.LineToLine(detLeft, l1, out);
console.log("Intersection when y=1:", intersect, out);

y = 1e-14; // almost 0
Phaser.Geom.Line.SetToAngle(detLeft, x, y, direction - Math.PI / 2, lookAheadLength);
intersect = Phaser.Geom.Intersects.LineToLine(detLeft, l1, out);
console.log("Intersection when y=1e-14:", intersect, out, Phaser.Math.Distance.Between(x, y, out.x, out.y));

y = 0;
Phaser.Geom.Line.SetToAngle(detLeft, x, y, direction - Math.PI / 2, lookAheadLength);
intersect = Phaser.Geom.Intersects.LineToLine(detLeft, l1, out);
console.log("Intersection when y=0:", intersect, out, Phaser.Math.Distance.Between(x, y, out.x, out.y));
