import { describe, expect, it } from 'vitest';
import { BOMB_TILE_TICKS, FIRE_SPEED, SUB } from '../../src/sim/constants';
import { at, events, explosionOf, idle, p, playing, press, teleport, tick, walk } from './helpers';

const SEG = SUB / FIRE_SPEED; // 24 ticks per tile of cord

describe('L1 poser', () => {
  it('places a bomb on the player tile with a held cord', () => {
    const run = playing();
    press(run, 0);
    const bomb = run.s.bombs[0]!;
    expect(bomb.tile).toBe(at(1, 1));
    expect(bomb.owner).toBe(0);
    const cord = run.s.cords[0]!;
    expect(cord.held).toBe(true);
    expect(cord.nodes.map((n) => n.tile)).toEqual([at(1, 1)]);
    expect(p(run, 0).heldCord).toBe(cord.id);
    expect(events(run, 'bomb-placed')).toHaveLength(1);
  });

  it('denies a bomb beyond bombsMax, once the first cord is released', () => {
    const run = playing();
    press(run, 0);
    walk(run, 0, [[2, 1]]);
    press(run, 0); // lights and lets go
    expect(p(run, 0).heldCord).toBeNull();
    press(run, 0);
    expect(events(run, 'action-denied')).toHaveLength(1);
    expect(run.s.bombs).toHaveLength(1);
  });
});

describe('L2 dérouler et rembobiner', () => {
  it('lays the cord tile by tile and reels it in when stepping back', () => {
    const run = playing();
    press(run, 0);
    walk(run, 0, [[2, 1], [3, 1]]);
    expect(run.s.cords[0]!.nodes.map((n) => n.tile)).toEqual([at(1, 1), at(2, 1), at(3, 1)]);
    expect(events(run, 'cord-extended').map((e) => e.length)).toEqual([1, 2]);
    walk(run, 0, [[2, 1]]);
    expect(run.s.cords[0]!.nodes.map((n) => n.tile)).toEqual([at(1, 1), at(2, 1)]);
    expect(events(run, 'cord-rewound').map((e) => e.length)).toEqual([1]);
    expect(run.s.cords[0]!.held).toBe(true);
  });

  it('lights at the hand when the cord reaches cordMax', () => {
    const run = playing();
    press(run, 0);
    walk(run, 0, [[2, 1], [3, 1], [4, 1], [5, 1], [6, 1]]);
    expect(run.s.cords[0]!.held).toBe(true);
    walk(run, 0, [[7, 1]]);
    const lit = events(run, 'cord-lit');
    expect(lit).toHaveLength(1);
    expect(lit[0]!.ignition.kind).toBe('max-length');
    expect(lit[0]!.ignition.tile).toBe(at(7, 1));
    expect(p(run, 0).heldCord).toBeNull();
  });

  it('a loop over its own cord makes a knot: the fire takes the shortcut', () => {
    const run = playing();
    p(run, 0).cordMax = 20;
    p(run, 0).range = 1;
    press(run, 0);
    walk(run, 0, [[2, 1], [3, 1], [4, 1], [5, 1], [5, 2], [5, 3], [4, 3], [3, 3], [3, 2], [3, 1]]);
    expect(run.s.cords[0]!.nodes).toHaveLength(11);
    const lit = press(run, 0);
    idle(run, 200);
    const boom = events(run, 'explosion')[0]!;
    // hand (3,1) touches node 2 (3,1): 2 tiles to the bomb, not 10.
    expect(boom.tick - lit).toBe(2 * SEG + BOMB_TILE_TICKS);
    const jump = events(run, 'fire-jump')[0]!;
    expect(jump.tile).toBe(at(3, 1));
    expect(jump.fromCord).toBe(jump.toCord);
    expect(run.s.fronts).toHaveLength(0);
    expect(run.s.cords).toHaveLength(0);
  });
});

describe('L3 allumer', () => {
  it('reeled in to length 0 on the bomb tile, the holder still holds; lighting gives 0.6 s (§26)', () => {
    const run = playing();
    teleport(run, 0, 2, 1);
    press(run, 0);
    walk(run, 0, [[3, 1], [2, 1]]);
    expect(run.s.cords[0]!.nodes).toHaveLength(1);
    expect(run.s.cords[0]!.held).toBe(true);
    const lit = press(run, 0);
    idle(run, 40);
    expect(events(run, 'explosion')[0]!.tick - lit).toBe(BOMB_TILE_TICKS);
    expect(run.s.deaths[0]!.player).toBe(0);
  });

  it('a length-0 cord blows 0.6 s after lighting', () => {
    const run = playing();
    press(run, 0);
    const lit = press(run, 0);
    idle(run, 40);
    expect(events(run, 'explosion')[0]!.tick - lit).toBe(BOMB_TILE_TICKS);
  });

  it('lighting releases the cord so the next press places a new bomb', () => {
    const run = playing();
    p(run, 0).bombsMax = 2;
    press(run, 0);
    walk(run, 0, [[2, 1]]);
    press(run, 0);
    expect(events(run, 'cord-lit')[0]!.ignition.kind).toBe('hand');
    expect(run.s.cords[0]!.held).toBe(false);
    press(run, 0);
    expect(events(run, 'bomb-placed')).toHaveLength(2);
    expect(run.s.bombs[1]!.tile).toBe(at(2, 1));
  });
});

describe('L4 le feu court', () => {
  it('a 6-tile cord lit at the hand blows exactly 6×24+36 ticks later', () => {
    const run = playing();
    p(run, 0).cordMax = 10;
    press(run, 0);
    walk(run, 0, [[2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [7, 1]]);
    const lit = press(run, 0);
    idle(run, 200);
    expect(events(run, 'bomb-fuse')[0]!.tick - lit).toBe(6 * SEG);
    expect(events(run, 'explosion')[0]!.tick - lit).toBe(6 * SEG + BOMB_TILE_TICKS);
  });

  it('fire passes to another player cord sharing a tile, both ways, and burns back to its hand', () => {
    const run = playing();
    teleport(run, 1, 7, 1);
    press(run, 1);
    walk(run, 1, [[7, 2], [7, 3], [7, 4], [7, 5]]);
    teleport(run, 0, 3, 3);
    p(run, 0).cordMax = 10;
    press(run, 0);
    walk(run, 0, [[4, 3], [5, 3], [6, 3], [7, 3], [8, 3], [9, 3]]);
    const p0Bomb = run.s.bombs.find((b) => b.owner === 0)!;
    const p1Bomb = run.s.bombs.find((b) => b.owner === 1)!;
    const lit = press(run, 0);
    idle(run, 250);

    const jump = events(run, 'fire-jump').find((e) => e.tile === at(7, 3))!;
    expect(jump.tick - lit).toBe(2 * SEG);
    expect(jump.fromCord).toBe(p0Bomb.cordId);
    expect(jump.toCord).toBe(p1Bomb.cordId);
    const burnt = events(run, 'hand-burnt')[0]!;
    expect(burnt.player).toBe(1);
    expect(burnt.tick - lit).toBe(4 * SEG);
    expect(p(run, 1).heldCord).toBeNull();

    const x1 = explosionOf(run, p1Bomb.id)!;
    expect(x1.tick - lit).toBe(4 * SEG + BOMB_TILE_TICKS);
    expect(x1.trigger.kind).toBe('fire');
    if (x1.trigger.kind !== 'fire') throw new Error();
    expect(x1.trigger.ignition.by).toBe(0);
    expect(x1.trigger.ignition.kind).toBe('hand');
    expect(x1.trigger.trail).toEqual([at(9, 3), at(8, 3), at(7, 3), at(7, 2), at(7, 1)]);
    expect(explosionOf(run, p0Bomb.id)!.tick - lit).toBe(6 * SEG + BOMB_TILE_TICKS);
    expect(run.s.deaths).toHaveLength(0);
  });

  it('converging fires meet mid-segment and annihilate there', () => {
    const run = playing();
    // P0: bomb (1,1), held cord along row 1 to (7,1), range 1.
    p(run, 0).cordMax = 10;
    p(run, 0).range = 1;
    press(run, 0);
    walk(run, 0, [[2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [7, 1]]);
    const cordId = run.s.cords[0]!.id;
    // P1: range 4 bomb at (1,5) whose column reaches P0's bomb; 3-tile cord → blows 108 ticks after lighting.
    teleport(run, 1, 1, 5);
    p(run, 1).range = 4;
    press(run, 1);
    walk(run, 1, [[2, 5], [3, 5], [3, 6]]);
    const p1Lit = press(run, 1);
    idle(run, 95);
    const lit = press(run, 0); // P0 lights at the hand 12 ticks before P1's blast chains its bomb
    expect(lit - p1Lit).toBe(96);
    // Hand front: node 4 at +48, then 4→3. Bomb side: P0's own range-1 blast lights node 1 at +12,
    // node 3 reached at +60 while the hand front is halfway down 4→3: they meet at +66.
    idle(run, 65);
    expect(run.s.fronts.filter((f) => f.cordId === cordId)).toHaveLength(2);
    tick(run);
    expect(run.s.fronts.filter((f) => f.cordId === cordId)).toHaveLength(0);
    expect(run.s.cords.find((c) => c.id === cordId)).toBeUndefined();
    const [x1, x0] = run.s.explosions;
    expect(x1!.owner).toBe(1);
    expect(x0!.owner).toBe(0);
    expect(x0!.tick - lit).toBe(12);
    expect(run.s.deaths).toHaveLength(0);
  });

  it('two holders entering the same tile in the same tick cross their cords', () => {
    const run = playing();
    teleport(run, 0, 2, 1);
    teleport(run, 1, 4, 1);
    press(run, 0);
    press(run, 1);
    for (let i = 0; i < 15; i++) tick(run, { 0: { dir: 'right', action: false }, 1: { dir: 'left', action: false } });
    const c0 = run.s.cords.find((c) => c.owner === 0)!;
    const c1 = run.s.cords.find((c) => c.owner === 1)!;
    expect(c0.nodes.at(-1)!.tile).toBe(at(3, 1));
    expect(c1.nodes.at(-1)!.tile).toBe(at(3, 1));
    const lit = press(run, 0);
    const jump = events(run, 'fire-jump')[0]!;
    expect(jump).toMatchObject({ tile: at(3, 1), fromCord: c0.id, toCord: c1.id, tick: lit });
    expect(events(run, 'hand-burnt')[0]).toMatchObject({ player: 1, tick: lit });
  });

  it('reeling in a segment the fire is on burns the hand', () => {
    const run = playing();
    press(run, 0);
    walk(run, 0, [[2, 1], [3, 1], [4, 1]]);
    const cord = run.s.cords[0]!;
    cord.nodes[2]!.burnt = true;
    const ignition = { kind: 'hand' as const, by: 1 as const, tile: at(3, 1), tick: 0, explosionId: null };
    run.s.fronts.push({ id: 9001, cordId: cord.id, from: 2, to: 3, progress: 200, ignition, trail: [at(3, 1)] });
    walk(run, 0, [[3, 1]]);
    expect(events(run, 'cord-rewound')).toHaveLength(1);
    expect(events(run, 'hand-burnt')[0]!.player).toBe(0);
    expect(p(run, 0).heldCord).toBeNull();
    expect(run.s.fronts.some((f) => f.id === 9001)).toBe(false);
  });

  it('a bomb placed on a burning tile catches at once', () => {
    const run = playing();
    teleport(run, 0, 7, 3);
    const ignition = { kind: 'hand' as const, by: 1 as const, tile: at(7, 1), tick: 0, explosionId: null };
    run.s.cords.push({
      id: 9000,
      owner: 1,
      bombId: 9999,
      held: false,
      nodes: [
        { tile: at(7, 2), burnt: true },
        { tile: at(7, 3), burnt: false },
      ],
    });
    run.s.fronts.push({ id: 9001, cordId: 9000, from: 0, to: 1, progress: 600, ignition, trail: [at(7, 2)] });
    const placed = press(run, 0);
    const lit = events(run, 'cord-lit').find((e) => e.ignition.by === 0)!;
    expect(lit.ignition.kind).toBe('walked-into-fire');
    expect(lit.tick).toBe(placed);
    expect(run.s.bombs[0]!.fuse).toBe(BOMB_TILE_TICKS);
  });

  it('a holder stepping onto a burning tile lights its own cord there', () => {
    const run = playing();
    teleport(run, 0, 5, 3);
    press(run, 0);
    walk(run, 0, [[6, 3]]);
    const ignition = { kind: 'hand' as const, by: 1 as const, tile: at(7, 1), tick: 0, explosionId: null };
    run.s.cords.push({
      id: 9000,
      owner: 1,
      bombId: 9999,
      held: false,
      nodes: [
        { tile: at(7, 1), burnt: true },
        { tile: at(7, 2), burnt: true },
        { tile: at(7, 3), burnt: false },
        { tile: at(7, 4), burnt: false },
      ],
    });
    run.s.fronts.push({ id: 9001, cordId: 9000, from: 1, to: 2, progress: 600, ignition, trail: [at(7, 1), at(7, 2)] });
    walk(run, 0, [[7, 3]]);
    const lit = events(run, 'cord-lit').find((e) => e.ignition.by === 0)!;
    expect(lit.ignition.kind).toBe('walked-into-fire');
    expect(lit.ignition.tile).toBe(at(7, 3));
    expect(p(run, 0).heldCord).toBeNull();
  });

  it('fire never hurts a player standing on a burning cord', () => {
    const run = playing();
    p(run, 0).cordMax = 10;
    press(run, 0);
    walk(run, 0, [[2, 1], [3, 1], [4, 1], [5, 1]]);
    press(run, 0);
    // Walk back along the burning cord: the player (4 tiles/s) runs through the flame (2.5 tiles/s).
    walk(run, 0, [[4, 1], [3, 1]]);
    expect(run.s.fronts.length).toBeGreaterThan(0);
    expect(p(run, 0).alive).toBe(true);
    expect(run.s.deaths).toHaveLength(0);
  });
});

describe('L5 boum', () => {
  const lone = (x: number, y: number) => {
    const run = playing();
    teleport(run, 0, x, y);
    press(run, 0);
    press(run, 0);
    idle(run, 40);
    return run;
  };
  const tilesOf = (run: ReturnType<typeof playing>) => [...run.s.explosions[0]!.tiles].sort((a, b) => a - b);
  const sorted = (ts: number[]) => [...ts].sort((a, b) => a - b);

  it('cross of range 2 on open floor', () => {
    expect(tilesOf(lone(3, 3))).toEqual(
      sorted([at(3, 3), at(3, 2), at(3, 1), at(3, 4), at(3, 5), at(2, 3), at(1, 3), at(4, 3), at(5, 3)]),
    );
  });

  it('frame and pillars stop the cross before their tile', () => {
    expect(tilesOf(lone(1, 1))).toEqual(sorted([at(1, 1), at(1, 2), at(1, 3), at(2, 1), at(3, 1)]));
    expect(tilesOf(lone(3, 2))).toEqual(sorted([at(3, 2), at(3, 1), at(3, 3), at(3, 4)]));
  });

  it('a crate is included, destroyed, and stops the cross', () => {
    const run = playing();
    run.s.cells[at(4, 3)] = 'crate';
    teleport(run, 0, 3, 3);
    press(run, 0);
    press(run, 0);
    idle(run, 40);
    const tiles = run.s.explosions[0]!.tiles;
    expect(tiles).toContain(at(4, 3));
    expect(tiles).not.toContain(at(5, 3));
    expect(run.s.cells[at(4, 3)]).toBe('floor');
    expect(events(run, 'crate-destroyed').map((e) => e.tile)).toEqual([at(4, 3)]);
  });

  it('chain reaction in the same tick, and players in the cross die', () => {
    const run = playing();
    p(run, 0).range = 3;
    teleport(run, 1, 5, 3);
    press(run, 1);
    walk(run, 1, [[5, 4], [5, 5], [6, 5]]);
    teleport(run, 0, 3, 3);
    press(run, 0);
    press(run, 0);
    idle(run, 40);
    const [first, second] = run.s.explosions;
    expect(first!.tiles).toContain(at(5, 3));
    expect(first!.tiles).not.toContain(at(6, 3)); // range 3, stopped by P1's bomb
    expect(second!.tick).toBe(first!.tick);
    expect(second!.trigger).toEqual({ kind: 'chain', byExplosion: first!.id });
    expect(second!.owner).toBe(1);
    expect(run.s.deaths).toEqual([{ player: 0, tick: first!.tick, explosionId: first!.id }]);
    expect(p(run, 1).alive).toBe(true);
  });

  it('a blast through the middle of a held cord blows its bomb early and burns back to the hand', () => {
    const run = playing();
    teleport(run, 1, 7, 1);
    press(run, 1);
    walk(run, 1, [[7, 2], [7, 3], [7, 4], [7, 5]]);
    teleport(run, 0, 5, 3);
    press(run, 0);
    walk(run, 0, [[5, 4], [5, 5], [6, 5]]);
    const p1Bomb = run.s.bombs.find((b) => b.owner === 1)!;
    press(run, 0);
    idle(run, 300);
    const first = run.s.explosions[0]!;
    expect(first.owner).toBe(0);
    const lit = events(run, 'cord-lit').find((e) => e.ignition.kind === 'blast')!;
    expect(lit.ignition).toMatchObject({ by: 0, tile: at(7, 3), explosionId: first.id });
    expect(events(run, 'hand-burnt')[0]!.tick - first.tick).toBe(2 * SEG);
    const x1 = explosionOf(run, p1Bomb.id)!;
    expect(x1.tick - first.tick).toBe(2 * SEG + BOMB_TILE_TICKS);
    if (x1.trigger.kind !== 'fire') throw new Error('expected fire trigger');
    expect(x1.trigger.ignition.explosionId).toBe(first.id);
    expect(run.s.deaths).toHaveLength(0);
  });

  it('a crate stops every explosion of its tick, whatever the bomb order', () => {
    for (const firstPlacer of [0, 1] as const) {
      const run = playing([0, 1, 2]);
      run.s.cells[at(5, 1)] = 'crate';
      teleport(run, 0, 3, 1);
      teleport(run, 1, 5, 3);
      teleport(run, 2, 6, 1);
      p(run, 0).range = 3;
      p(run, 1).range = 3;
      const second = firstPlacer === 0 ? 1 : 0;
      press(run, firstPlacer);
      press(run, second);
      tick(run, { 0: { dir: null, action: true }, 1: { dir: null, action: true } });
      idle(run, BOMB_TILE_TICKS);
      expect(run.s.explosions).toHaveLength(2);
      expect(run.s.explosions[0]!.tick).toBe(run.s.explosions[1]!.tick);
      for (const x of run.s.explosions) expect(x.tiles).not.toContain(at(6, 1));
      expect(p(run, 2).alive).toBe(true);
      expect(events(run, 'crate-destroyed').map((e) => e.tile)).toEqual([at(5, 1)]);
      expect(run.s.cells[at(5, 1)]).toBe('floor');
    }
  });

  it('fire and blast reaching the same bomb in the same tick make one explosion (§26)', () => {
    const run = playing();
    teleport(run, 1, 3, 1);
    press(run, 0);
    press(run, 1);
    tick(run, { 0: { dir: null, action: true }, 1: { dir: null, action: true } });
    idle(run, BOMB_TILE_TICKS);
    const ids = run.s.explosions.map((x) => x.bombId);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(run.s.explosions[1]!.trigger).toEqual({ kind: 'chain', byExplosion: run.s.explosions[0]!.id });
  });

  it('a blast lights two cords sharing a tile', () => {
    const run = playing();
    const cord = (id: number, owner: 1 | 2, tiles: number[]) => ({
      id,
      owner,
      bombId: id + 1,
      held: false,
      nodes: tiles.map((tile) => ({ tile, burnt: false })),
    });
    run.s.cords.push(cord(9000, 1, [at(5, 5), at(5, 4), at(5, 3)]), cord(9100, 1, [at(7, 3), at(6, 3), at(5, 3)]));
    teleport(run, 0, 3, 3);
    press(run, 0);
    const lit = press(run, 0);
    idle(run, BOMB_TILE_TICKS);
    const boom = run.s.explosions[0]!;
    expect(boom.tick - lit).toBe(BOMB_TILE_TICKS);
    for (const id of [9000, 9100]) {
      const c = run.s.cords.find((x) => x.id === id)!;
      expect(c.nodes[2]!.burnt).toBe(true);
      const fronts = run.s.fronts.filter((f) => f.cordId === id);
      expect(fronts).toHaveLength(1);
      expect(fronts[0]!.ignition).toMatchObject({ kind: 'blast', by: 0, explosionId: boom.id });
    }
  });

  it('a held cord whose bomb is chain-blown is let go: the next Action places a bomb', () => {
    const run = playing();
    teleport(run, 1, 5, 3);
    press(run, 1);
    walk(run, 1, [[5, 4], [5, 5], [6, 5]]);
    teleport(run, 0, 3, 3);
    press(run, 0);
    press(run, 0);
    idle(run, BOMB_TILE_TICKS);
    expect(run.s.explosions.map((x) => x.owner)).toEqual([0, 1]);
    expect(p(run, 1).heldCord).toBeNull();
    idle(run, 40);
    press(run, 1);
    expect(events(run, 'bomb-placed').filter((e) => e.player === 1)).toHaveLength(2);
    expect(events(run, 'cord-lit').filter((e) => e.ignition.by === 1 && e.ignition.kind === 'hand')).toHaveLength(0);
  });

  it('a holder killed by a blast lights its cord at the hand', () => {
    const run = playing();
    teleport(run, 1, 7, 1);
    press(run, 1);
    walk(run, 1, [[7, 2], [7, 3]]);
    teleport(run, 0, 5, 3);
    press(run, 0);
    walk(run, 0, [[5, 4], [5, 5], [6, 5]]);
    const p1Bomb = run.s.bombs.find((b) => b.owner === 1)!;
    press(run, 0);
    idle(run, 300);
    const death = run.s.deaths[0]!;
    expect(death.player).toBe(1);
    const lit = events(run, 'cord-lit').find((e) => e.ignition.by === 1)!;
    expect(lit.ignition.kind).toBe('holder-died');
    expect(lit.tick).toBe(death.tick);
    // 24 ticks of death freeze, then 2 tiles of cord and the bomb tile.
    expect(explosionOf(run, p1Bomb.id)!.tick - death.tick).toBe(24 + 2 * SEG + BOMB_TILE_TICKS);
  });
});
