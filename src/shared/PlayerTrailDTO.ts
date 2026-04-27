export default interface PlayerTrailDTO {
  points: {
    x: number;
    y: number;
    direction: number;
    velocity: number[];
    speedMult: number;
    tick: number;
  }[];
}
