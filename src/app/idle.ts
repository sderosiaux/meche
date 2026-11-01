// Debug-only opponents that never press anything (?debug=1&opponents=idle): stationary targets
// for trying cords, knots and hijacks by hand. Not the bots, and never used in a normal match.
import type { Bot, CreateBot } from '../bots/api';

export const createIdleOpponent: CreateBot = (id, level): Bot => ({
  id,
  level,
  decide: () => ({ dir: null, action: false }),
});
