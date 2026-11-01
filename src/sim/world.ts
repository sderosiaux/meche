import type { Bomb, Cord, GameState, Player, SimEvent, Tile } from './types';
import { tileOf } from './grid';

export const emit = (s: GameState, e: SimEvent): void => {
  s.events.push(e);
};

export const newId = (s: GameState): number => s.nextId++;

export const cordById = (s: GameState, id: number): Cord | undefined => s.cords.find((c) => c.id === id);

export const bombAt = (s: GameState, tile: Tile): Bomb | undefined => s.bombs.find((b) => b.tile === tile);

export const playerTile = (p: Player): Tile => tileOf(p.x, p.y);

/** Players in id order, skipping absent slots. */
export function presentPlayers(s: GameState): Player[] {
  const out: Player[] = [];
  for (const p of s.players) if (p) out.push(p);
  return out;
}

export function isOpen(s: GameState, tile: Tile): boolean {
  return s.cells[tile] === 'floor' && !bombAt(s, tile);
}
