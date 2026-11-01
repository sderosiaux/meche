// The sim only reads inputs while a round is live and not frozen (src/sim/step.ts returns early
// during countdown, death freeze and after the round). Inputs sampled on other ticks would be
// thrown away, so the human's latched action waits for the first tick that reads it.
import type { GameState, PlayerInput } from '../sim/types';

export function simReadsInput(state: GameState): boolean {
  return (state.phase === 'playing' || state.phase === 'resolving') && state.freeze === 0;
}

/** Samples the human only when the coming step will use the input; otherwise leaves it untouched. */
export function humanInputFor(state: GameState, sample: () => PlayerInput): PlayerInput | undefined {
  return simReadsInput(state) ? sample() : undefined;
}
