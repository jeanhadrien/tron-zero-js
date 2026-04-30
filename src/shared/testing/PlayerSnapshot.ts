export interface PlayerSnapshot {
  readonly name: string
  readonly dead: boolean
  readonly alive: boolean
  readonly x: number
  readonly y: number
  readonly direction: number
  readonly trailLength: number
  readonly rubber: number
  readonly speedMult: number
}
