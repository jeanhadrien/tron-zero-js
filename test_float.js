let direction = 0;
let ROTATION_ANGLE = Math.PI / 2;
for(let i=0; i<100; i++) {
  direction = direction - ROTATION_ANGLE;
  direction = direction % (Math.PI * 2);
  let vx = Math.cos(direction) * 150;
  let vy = Math.sin(direction) * 150;
  if (Math.abs(vx) < 0.000001) { vx = 0; }
  if (Math.abs(vy) < 0.000001) { vy = 0; }
  if (vx !== 0 && vy !== 0) {
    console.log("DIAGONAL at " + i + " vx=" + vx + " vy=" + vy + " dir=" + direction);
  }
}
console.log("Done");
