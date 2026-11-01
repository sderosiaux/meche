// Contract for src/bots/index.ts. Bots produce the same inputs a human would.
import type { GameState, PlayerId, PlayerInput } from '../sim/types';

export type BotLevel = 'facile' | 'moyen';

export interface Bot {
  readonly id: PlayerId;
  readonly level: BotLevel;
  /** Called once per simulation tick with the current state; keeps its own memory (reaction delay, plan). */
  decide(state: GameState): PlayerInput;
}

export type CreateBot = (id: PlayerId, level: BotLevel, seed: number) => Bot;
