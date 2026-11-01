// Starting values from GAME_SPEC.md §30. All simulation arithmetic is integer:
// distances in sub-units (SUB per tile), durations in ticks (TICK_HZ per second).

export const TICK_HZ = 60;
export const SUB = 960; // 960 makes every speed in the spec an integer per tick

export const GRID_W = 15; // 13 playable columns + frame
export const GRID_H = 13; // 11 playable rows + frame

export const WALK_SPEED = 64; // sub/tick = 4 tiles/s
export const FIRE_SPEED = 40; // sub/tick = 2.5 tiles/s, slower than walking: a visible flame can always be fled
export const BOMB_TILE_TICKS = 36; // 0.6 s for the fire to cross the bomb's own tile
export const BLAST_TICKS = 30; // 0.5 s lethal
export const CORNER_ASSIST = 384; // 40 % of a tile

export const START_BOMBS = 1;
export const START_RANGE = 2;
export const START_CORD_MAX = 6; // tiles; reaching it lights the cord at the hand
export const CORD_WARN = 2; // tiles before the max: hand end flashes

export const COUNTDOWN_TICKS = 180; // 3 s before inputs count
export const ROUND_TIMEOUT_TICKS = 150 * TICK_HZ; // prototype: no grande mèche, 2:30 then draw
export const RESULT_WINDOW_TICKS = 90; // 1.5 s after <= 1 alive before the result is final
export const DEATH_FREEZE_TICKS = 24; // 0.4 s gameplay freeze on a death

export const CRATE_DENSITY_PERMILLE = 650;

export const FORECAST_HORIZON_TICKS = 360; // 6 s look-ahead for bots
