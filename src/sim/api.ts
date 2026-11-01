// Signatures that src/sim/index.ts must export. Render, bots and tests code against these.
import type { Forecast, GameState, RoundConfig, TickInputs, Tile } from './types';

export interface SimApi {
  /** Seeded, symmetric arena; phase 'countdown'. Same config → same state. */
  createRound(config: RoundConfig): GameState;
  /** Pure: never mutates `state`, returns the next state with its `events`. */
  step(state: GameState, inputs: TickInputs): GameState;
  /** Look-ahead with idle inputs and invulnerable players. Never mutates `state`. */
  forecast(state: GameState, horizon?: number): Forecast;
  /** Stable hash of the gameplay state (events excluded) for determinism tests. */
  hashState(state: GameState): string;
  tileOf(x: number, y: number): Tile;
  tileX(tile: Tile): number;
  tileY(tile: Tile): number;
  /** Floor without a bomb, ignoring walkableBy. */
  isOpen(state: GameState, tile: Tile): boolean;
}
