/** Tunable CPU budgets and reaction timing for labyrinth bot AI. */
export const BOT_AI_BUDGET = {
  BFS_VISIT_BUDGET_CURRENT: 800,
  BFS_VISIT_BUDGET_LOOKAHEAD: 400,
  BFS_MAX_RADIUS: 18,
  LOOKAHEAD_TICKS: 4,
  REAR_RAY_LENGTH: 400,
  PER_TICK_BUDGET_MS: 2.0,
  PER_FRAME_BUDGET_MS: 5.0,
  /** Min ticks between bot turn decisions (lower = faster reactions). */
  ACTION_COOLDOWN_TICKS: 3,
  /** Extended cooldown after TRAPPER double-turn. */
  TRAPPER_COOLDOWN_TICKS: 12,
  /** Front-ray distance that forces survival over attack (px, near rubber zone). */
  SURVIVAL_THRESHOLD_BASE: 28,
  SURVIVAL_THRESHOLD_SLIDE: 12,
  SURVIVAL_THRESHOLD_MAX: 50,
  /** Entrapment score that forces escape mode (0–100, high = rarely defensive). */
  ENTRAPMENT_ESCAPE_THRESHOLD: 78,
  /** Distance at which front-wall pressure feeds entrapment score (px). */
  FRONT_PRESSURE_DISTANCE: 120,
  /** Max range to acquire a hunt target (px). */
  HUNT_RANGE: 900,
  /** Trap score multiplier for attack-mode candidate ranking. */
  TRAP_SCORE_MULTIPLIER: 1.4,
} as const;