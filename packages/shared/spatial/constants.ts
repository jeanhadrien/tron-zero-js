/** Uniform grid cell size in world-units. */
export const SPATIAL_CELL_SIZE = 320;

/** Dev-only dual-path collision comparison (compile-time). */
export const SPATIAL_SHADOW_DIFF = false;

/** Dev-only grid/ECS consistency checks after mutations. */
export const SPATIAL_DEBUG_VALIDATE = SPATIAL_SHADOW_DIFF;
