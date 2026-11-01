// Pure decisions of the audio engine, kept apart from Web Audio so they can be tested.
import { GRID_W } from '../sim/constants';
import type { GameState, Phase } from '../sim/types';

export type MusicScene = 'menu' | 'match' | 'tension';

/** No round yet → menu. Two survivors out of a bigger field → tension. Otherwise the match track. */
export function musicScene(state: GameState | null): MusicScene {
  if (!state) return 'menu';
  if (state.phase !== 'playing' && state.phase !== 'resolving') return 'match';
  let alive = 0;
  let present = 0;
  for (const p of state.players) {
    if (!p) continue;
    present++;
    if (p.alive) alive++;
  }
  return present > 2 && alive === 2 ? 'tension' : 'match';
}

/** Music sits back while the round is not running (pause, interlude, match over); the menu plays full. */
export function musicLevel(state: GameState | null, active: boolean): number {
  if (!state) return 1;
  return active ? 1 : 0.45;
}

/**
 * Identity of a round that survives step()'s structuredClone (object identity does not): its seed, and a
 * tick that only moves forward inside one round.
 */
export interface RoundStamp {
  readonly seed: number;
  readonly tick: number;
}

export function roundStamp(state: GameState): RoundStamp {
  return { seed: state.config.seed, tick: state.tick };
}

export function sameRound(prev: RoundStamp | null, cur: RoundStamp): boolean {
  return prev !== null && prev.seed === cur.seed && cur.tick >= prev.tick;
}

export interface CountdownMark extends RoundStamp {
  readonly phase: Phase;
  readonly beat: number; // countdown second index (0, 1, 2), -1 outside the countdown
}

export const COUNTDOWN_BEAT_TICKS = 60;

export function countdownMark(state: GameState): CountdownMark {
  return {
    ...roundStamp(state),
    phase: state.phase,
    beat: state.phase === 'countdown' ? Math.floor(state.phaseTick / COUNTDOWN_BEAT_TICKS) : -1,
  };
}

/**
 * Woodblock on each countdown second, bell when play starts. Compared frame to frame, so a frame that
 * skips several ticks still fires each cue once; a new round starts from scratch.
 */
export function countdownCue(prev: CountdownMark | null, cur: CountdownMark): 'tick' | 'go' | null {
  const same = sameRound(prev, cur);
  if (cur.phase === 'countdown') return !same || cur.beat > prev!.beat ? 'tick' : null;
  if (same && prev!.phase === 'countdown' && cur.phase === 'playing') return 'go';
  return null;
}

/** Stereo position of a tile: frame columns hard left/right are kept at ±0.8. */
export function panForTile(tile: number): number {
  const x = tile % GRID_W;
  return Math.max(-0.8, Math.min(0.8, (x - (GRID_W - 1) / 2) / ((GRID_W - 1) / 2)));
}

/** A cross covering 7 tiles or more (range 3 on open floor) gets the big explosion. */
export function boomId(crossTiles: number): 'boom-small' | 'boom-big' {
  return crossTiles >= 7 ? 'boom-big' : 'boom-small';
}

/** Round-robin over `count` variants. */
export function nextVariant(counters: Map<string, number>, id: string, count: number): number {
  const k = counters.get(id) ?? 0;
  counters.set(id, k + 1);
  return count > 0 ? k % count : 0;
}

/** Where a loop with the same length as the playing one should start so the beat carries over. */
export function alignedOffset(now: number, origin: number, loopStart: number, loopLength: number): number {
  const pos = (((now - origin) % loopLength) + loopLength) % loopLength;
  return loopStart + pos;
}
