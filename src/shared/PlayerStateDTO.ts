import PlayerTrailDTO from './PlayerTrailDTO';

export default interface PlayerStateDTO {
  id: string;
  x: number;
  y: number;
  direction: number;
  speedMult: number;
  targetSpeed: number;
  rubber: number;
  isRunning: boolean;
  color: number;
  velocity: number[];
  trail: PlayerTrailDTO;
}
