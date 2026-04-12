const Phaser = require('phaser');
const line1 = new Phaser.Geom.Line(0, 0, 100, 0);
const line2 = new Phaser.Geom.Line(100, 0, 80, 0); // overlaps line1
let point = {x: 0, y: 0};
console.log("Overlap:", Phaser.Geom.Intersects.LineToLine(line1, line2, point), point);

const line3 = new Phaser.Geom.Line(100, 0, 100, 0); // 0-length line
const line4 = new Phaser.Geom.Line(100, 0, 80, 0); 
console.log("0-length:", Phaser.Geom.Intersects.LineToLine(line3, line4, point), point);

