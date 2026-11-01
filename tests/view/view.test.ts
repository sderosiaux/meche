import { describe, expect, it } from 'vitest';
import { loadFixture } from '../../src/app/fixtures';
import { matchPlayers, newMatch, recordRound, roundSeed, WINS_TO_TAKE } from '../../src/app/match';
import { frontEtaTicks, sizzleFrequency } from '../../src/audio/eta';
import { ActionLatch, DirStack } from '../../src/input/controls';
import { resolveDeathChain } from '../../src/render/chain';
import { cordPieces, knotTiles } from '../../src/render/cordShapes';
import { tileWorldX, tileWorldZ } from '../../src/render/coords';
import { BOMB_TILE_TICKS, FIRE_SPEED, GRID_W, SUB } from '../../src/sim/constants';
import type { FireFront, Ignition } from '../../src/sim/types';

const t = (x: number, y: number) => y * GRID_W + x;

describe('match flow', () => {
  it('lists the human then the bots', () => {
    expect(matchPlayers({ seed: 1, bots: 3, level: 'moyen' })).toEqual([0, 1, 2, 3]);
    expect(matchPlayers({ seed: 1, bots: 1, level: 'facile' })).toEqual([0, 1]);
  });

  it('derives distinct, reproducible round seeds', () => {
    const seeds = [0, 1, 2, 3, 4].map((r) => roundSeed(42, r));
    expect(new Set(seeds).size).toBe(5);
    expect(roundSeed(42, 3)).toBe(seeds[3]);
    expect(roundSeed(43, 3)).not.toBe(seeds[3]);
  });

  it('ignores draws and crowns the first to three wins', () => {
    let m = newMatch({ seed: 9, bots: 2, level: 'moyen' });
    m = recordRound(m, null);
    expect(m.wins).toEqual([0, 0, 0, 0]);
    expect(m.round).toBe(1);
    for (let i = 0; i < WINS_TO_TAKE - 1; i++) m = recordRound(m, 2);
    expect(m.champion).toBeNull();
    m = recordRound(m, 1);
    expect(m.champion).toBeNull();
    m = recordRound(m, 2);
    expect(m.champion).toBe(2);
    expect(m.wins[2]).toBe(WINS_TO_TAKE);
  });
});

describe('input bookkeeping', () => {
  it('lets the most recently pressed direction win and falls back on release', () => {
    const d = new DirStack();
    d.press('left');
    d.press('up');
    expect(d.current()).toBe('up');
    d.release('up');
    expect(d.current()).toBe('left');
    d.release('left');
    expect(d.current()).toBeNull();
  });

  it('keeps a tap until the next tick consumes it, once', () => {
    const a = new ActionLatch();
    a.press();
    expect(a.consume()).toBe(true);
    expect(a.consume()).toBe(false);
  });
});

describe('sizzle pitch', () => {
  const ign: Ignition = { kind: 'hand', by: 0, tile: 0, tick: 0, explosionId: null };
  const front = (from: number, to: number, progress: number): FireFront => ({ id: 1, cordId: 1, from, to, progress, ignition: ign, trail: [] });

  it('counts the remaining cord plus the bomb tile', () => {
    expect(frontEtaTicks(front(6, 5, 0))).toBe((6 * SUB) / FIRE_SPEED + BOMB_TILE_TICKS);
    expect(frontEtaTicks(front(1, 0, SUB))).toBe(BOMB_TILE_TICKS);
    expect(frontEtaTicks(front(2, 3, 100))).toBeNull();
  });

  it('rises as the bomb gets closer', () => {
    expect(sizzleFrequency(36)).toBeGreaterThan(sizzleFrequency(120));
    expect(sizzleFrequency(120)).toBeGreaterThan(sizzleFrequency(400));
  });
});

describe('fixtures and render helpers', () => {
  it('finds the knot where the two held cords cross', () => {
    const f = loadFixture('knot')!;
    expect(knotTiles(f.state)).toEqual([t(5, 3)]);
  });

  it('draws a burning segment only beyond the flame', () => {
    const f = loadFixture('burning')!;
    const s = f.animate!(0.5, f.state); // 1.25 tiles travelled from the hand
    const front = s.fronts[0]!;
    expect(front.from).toBe(5);
    const pieces = cordPieces(s, null, 1, new Map());
    // nodes 0..5 remain: 5 segments, the one under the flame shortened
    expect(pieces).toHaveLength(5);
    // segment 4-5 is drawn from node 4 (11,9) up to the flame, short of node 5 (12,9)
    const seg = pieces.find((p) => p.ax === tileWorldX(t(11, 9)) && p.az === tileWorldZ(t(11, 9)));
    expect(seg).toBeDefined();
    expect(seg!.bx).toBeLessThan(tileWorldX(t(12, 9)));
    expect(seg!.bx).toBeGreaterThan(tileWorldX(t(11, 9)));
  });

  it('follows a death back through a hijack to the player who lit it', () => {
    const f = loadFixture('blast')!;
    const chain = resolveDeathChain(f.state, 2);
    expect(chain.bombTiles).toEqual(new Set([t(7, 5), t(11, 9)]));
    expect(chain.crossTiles.has(t(5, 5))).toBe(true);
    expect(chain.crossTiles.has(t(11, 7))).toBe(true);
    expect(chain.trailTiles.has(t(9, 7))).toBe(true);
    expect(chain.stars).toEqual([
      { tile: t(11, 7), by: 3 },
      { tile: t(13, 9), by: 3 },
    ]);
  });
});

describe('key codes', () => {
  it('uses the physical code, or the key when a synthetic event has no code', async () => {
    const { keyCode } = await import('../../src/input/input');
    expect(keyCode({ code: 'KeyW', key: 'z' })).toBe('KeyW');
    expect(keyCode({ code: '', key: ' ' })).toBe('Space');
    expect(keyCode({ code: '', key: 'm' })).toBe('KeyM');
    expect(keyCode({ code: '', key: 'ArrowLeft' })).toBe('ArrowLeft');
  });
});
