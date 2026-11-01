// Match bookkeeping above the round simulation: who plays, round seeds, wins, champion. Pure.
import type { BotLevel } from '../bots/api';
import type { PlayerId } from '../sim/types';

export const WINS_TO_TAKE = 3;
export const HUMAN: PlayerId = 0;

export interface MatchSetup {
  readonly seed: number;
  readonly bots: 1 | 2 | 3;
  readonly level: BotLevel;
}

export interface MatchState {
  readonly setup: MatchSetup;
  /** Index of the round being played, from 0. */
  readonly round: number;
  readonly wins: readonly number[];
  readonly champion: PlayerId | null;
}

export function matchPlayers(setup: MatchSetup): PlayerId[] {
  const ids: PlayerId[] = [HUMAN];
  for (let i = 1; i <= setup.bots; i++) ids.push(i as PlayerId);
  return ids;
}

/** Deterministic per-round seed (32-bit mix), so a match replays from its seed. */
export function roundSeed(matchSeed: number, round: number): number {
  let h = (matchSeed ^ Math.imul(round + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** First match of a session keeps the URL seed (reproducible); each rematch gets a fresh one. */
export function matchSeed(baseSeed: number, matchIndex: number): number {
  return matchIndex === 0 ? baseSeed >>> 0 : roundSeed(baseSeed ^ 0x5bd1e995, 1000 + matchIndex);
}

export function newMatch(setup: MatchSetup): MatchState {
  return { setup, round: 0, wins: [0, 0, 0, 0], champion: null };
}

/** A draw (winner null) scores nobody. The match ends when someone reaches WINS_TO_TAKE. */
export function recordRound(m: MatchState, winner: PlayerId | null): MatchState {
  const wins = m.wins.map((w, i) => (i === winner ? w + 1 : w));
  const champion = winner !== null && (wins[winner] ?? 0) >= WINS_TO_TAKE ? winner : null;
  return { ...m, round: m.round + 1, wins, champion };
}

/** What follows the result screen of a finished round. */
export function afterInterlude(m: MatchState): 'next-round' | 'match-over' {
  return m.champion === null ? 'next-round' : 'match-over';
}
