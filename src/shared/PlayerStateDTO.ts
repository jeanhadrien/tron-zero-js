export default interface PlayerStateDTO {
    id: string;
    x: number;
    y: number;
    direction: number;
    speed: number;
    targetSpeed: number;
    rubber: number;
    isRunning: boolean;
    color: number;
    trailPoints: { x: number, y: number, direction: number, velocity: number[], tick: number }[];
}

