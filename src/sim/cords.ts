// L1 placing a bomb with its cord, L2 unrolling and rewinding while held.
import { lightHeld, releaseCord, tileHasFire } from './fire';
import type { GameState, Player, PlayerId, Tile } from './types';
import { bombAt, cordById, emit, newId, playerTile, presentPlayers } from './world';

export function placeBomb(s: GameState, p: Player): void {
  const tile = playerTile(p);
  const owned = s.bombs.filter((b) => b.owner === p.id).length;
  if (owned >= p.bombsMax || bombAt(s, tile)) {
    emit(s, { t: 'action-denied', player: p.id });
    return;
  }
  const bombId = newId(s);
  const cordId = newId(s);
  const walkableBy: PlayerId[] = presentPlayers(s)
    .filter((o) => o.alive && playerTile(o) === tile)
    .map((o) => o.id);
  s.bombs.push({ id: bombId, owner: p.id, tile, cordId, fuse: null, walkableBy, placedAt: s.tick, fireCause: null });
  s.cords.push({ id: cordId, owner: p.id, bombId, nodes: [{ tile, burnt: false }], held: true });
  p.heldCord = cordId;
  p.heldSince = s.tick;
  emit(s, { t: 'bomb-placed', bombId, player: p.id, tile });
  // Interpretation: a cord started on a burning tile catches like one walked onto it.
  if (tileHasFire(s, tile)) lightHeld(s, p, 'walked-into-fire');
}

/** Called when a holder's center tile changed. */
export function onHolderTileChange(s: GameState, p: Player, tile: Tile): void {
  if (p.heldCord === null) return;
  const cord = cordById(s, p.heldCord);
  if (!cord) {
    p.heldCord = null;
    p.heldSince = null;
    return;
  }
  const n = cord.nodes.length;
  if (n >= 2 && cord.nodes[n - 2]!.tile === tile) {
    const popped = n - 1;
    const prev = n - 2;
    const onSegment = s.fronts.filter(
      (f) => f.cordId === cord.id && ((f.from === popped && f.to === prev) || (f.from === prev && f.to === popped)),
    );
    cord.nodes.pop();
    p.heldSince = s.tick;
    emit(s, { t: 'cord-rewound', cordId: cord.id, player: p.id, length: cord.nodes.length - 1 });
    if (onSegment.length) {
      // The fire was on the segment being reeled in: it reaches the hand.
      s.fronts = s.fronts.filter((f) => !onSegment.includes(f));
      releaseCord(s, cord);
      emit(s, { t: 'hand-burnt', cordId: cord.id, player: p.id });
    }
    return;
  }
  cord.nodes.push({ tile, burnt: false });
  p.heldSince = s.tick;
  const length = cord.nodes.length - 1;
  emit(s, { t: 'cord-extended', cordId: cord.id, player: p.id, tile, length });
  if (tileHasFire(s, tile)) {
    lightHeld(s, p, 'walked-into-fire');
    return;
  }
  if (length >= p.cordMax) lightHeld(s, p, 'max-length');
}
