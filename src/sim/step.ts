// One simulation tick. Processing order inside a gameplay tick, fixed for determinism:
//   a. lingering blasts age
//   b. fuses count down; bombs at 0 explode (chains resolve breadth-first, same tick)
//   c. fire fronts advance (fronts born this tick wait for the next one)
//   d. players by id: Action (light if holding, else place), then movement, then cord unroll/rewind
//   e. active blasts: chain bombs on covered tiles, kill players, ignite cord nodes
//   f. crates hit this tick become floor (they stopped every explosion of the tick),
//      fully burnt cords are removed, round phase updates
import { COUNTDOWN_TICKS, RESULT_WINDOW_TICKS, ROUND_TIMEOUT_TICKS } from './constants';
import { applyBlasts, clearHitCrates, decayBlasts, tickFuses, type TickCtx } from './blast';
import { onHolderTileChange, placeBomb } from './cords';
import { advanceFronts, lightHeld } from './fire';
import { movePlayer } from './movement';
import type { GameState, PlayerId, TickInputs } from './types';
import { emit, playerTile } from './world';

export interface StepOptions {
  /** Nobody dies (forecast). */
  readonly invulnerable?: boolean;
  /** Run gameplay whatever the phase, without freeze or phase transitions (forecast). */
  readonly ignorePhase?: boolean;
}

function playersAct(s: GameState, inputs: TickInputs): void {
  for (const p of s.players) {
    if (!p || !p.alive) continue;
    const input = inputs[p.id];
    if (input?.action) {
      if (p.heldCord !== null) lightHeld(s, p, 'hand');
      else placeBomb(s, p);
    }
    const before = playerTile(p);
    movePlayer(s, p, input?.dir ?? null);
    const after = playerTile(p);
    if (after === before) continue;
    for (const b of s.bombs) {
      if (b.tile !== after && b.walkableBy.includes(p.id)) b.walkableBy = b.walkableBy.filter((id) => id !== p.id);
    }
    onHolderTileChange(s, p, after);
  }
}

function removeBurntCords(s: GameState): void {
  if (!s.cords.length) return;
  s.cords = s.cords.filter((c) => c.nodes.some((n) => !n.burnt) || s.fronts.some((f) => f.cordId === c.id));
}

function endRound(s: GameState, winner: PlayerId | null): void {
  s.phase = 'over';
  s.phaseTick = 0;
  s.winner = winner;
  emit(s, { t: 'round-over', winner });
}

function updatePhase(s: GameState): void {
  const alive = s.players.filter((p) => p !== null && p.alive);
  if (s.phase === 'playing') {
    s.phaseTick += 1;
    if (alive.length <= 1) {
      s.phase = 'resolving';
      s.phaseTick = 0;
    } else if (s.phaseTick >= ROUND_TIMEOUT_TICKS) {
      endRound(s, null);
    }
  } else if (s.phase === 'resolving') {
    s.phaseTick += 1;
    if (s.phaseTick >= RESULT_WINDOW_TICKS) endRound(s, alive.length === 1 ? alive[0]!.id : null);
  }
}

/** Mutates `s` in place. */
export function stepMut(s: GameState, inputs: TickInputs, opts: StepOptions = {}): void {
  s.tick += 1;
  s.events = [];
  if (!opts.ignorePhase) {
    if (s.phase === 'over') return;
    if (s.phase === 'countdown') {
      s.phaseTick += 1;
      if (s.phaseTick >= COUNTDOWN_TICKS) {
        s.phase = 'playing';
        s.phaseTick = 0;
      }
      return;
    }
    if (s.freeze > 0) {
      s.freeze -= 1;
      return;
    }
  }
  const ctx: TickCtx = { crates: new Set() };
  decayBlasts(s);
  tickFuses(s, ctx);
  advanceFronts(s);
  playersAct(s, inputs);
  applyBlasts(s, opts.invulnerable ?? false, ctx);
  clearHitCrates(s, ctx);
  removeBurntCords(s);
  if (!opts.ignorePhase) updatePhase(s);
}

export function step(state: GameState, inputs: TickInputs): GameState {
  const s = structuredClone(state);
  stepMut(s, inputs);
  return s;
}
