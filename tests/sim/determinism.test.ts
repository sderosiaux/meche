import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRound, hashState, step } from '../../src/sim';
import type { Dir, GameState, PlayerInput } from '../../src/sim/types';

const DIRS: (Dir | null)[] = [null, 'up', 'down', 'left', 'right'];

/** A noisy but reproducible input script (LCG, independent of the sim RNG). */
function scripted(seed: number, ticks: number, onTick?: (s: GameState, i: number) => void): GameState {
  let s = createRound({ seed, players: [0, 1, 2, 3] });
  let r = seed * 7919 + 13;
  const rnd = () => (r = (Math.imul(r, 1103515245) + 12345) >>> 0) / 4294967296;
  const held: (Dir | null)[] = [null, null, null, null];
  for (let i = 0; i < ticks; i++) {
    const inputs: PlayerInput[] = [0, 1, 2, 3].map((id) => {
      if (rnd() < 0.08) held[id] = DIRS[Math.floor(rnd() * DIRS.length)]!;
      return { dir: held[id]!, action: rnd() < 0.03 };
    });
    s = step(s, inputs);
    onTick?.(s, i);
  }
  return s;
}

describe('determinism', () => {
  it('same seed and inputs give the same state after 2000 ticks', () => {
    const a = scripted(42, 2000);
    const b = scripted(42, 2000);
    expect(hashState(a)).toBe(hashState(b));
    expect(a.explosions.length).toBeGreaterThan(0);
  });

  it('different seeds diverge', () => {
    expect(hashState(scripted(1, 600))).not.toBe(hashState(scripted(2, 600)));
  });

  it('hash ignores events but sees gameplay changes', () => {
    const s = scripted(5, 400);
    const h = hashState(s);
    expect(hashState({ ...s, events: [] })).toBe(h);
    const moved = structuredClone(s);
    moved.players[0]!.x += 1;
    expect(hashState(moved)).not.toBe(h);
  });
});

describe('purity', () => {
  it('step never mutates its input', () => {
    let checked = 0;
    scripted(9, 1500, (s, i) => {
      if (i % 50 !== 0) return;
      const before = structuredClone(s);
      step(s, [{ dir: 'right', action: true }, { dir: 'up', action: true }, null as never, undefined]);
      expect(s).toEqual(before);
      checked++;
    });
    expect(checked).toBe(30);
  });
});

describe('no hidden nondeterminism in src/sim', () => {
  it('uses no Math.random, Date or performance', () => {
    const root = join(__dirname, '../../src/sim');
    const files: string[] = [];
    const walkDir = (d: string) => {
      for (const f of readdirSync(d)) {
        const full = join(d, f);
        if (statSync(full).isDirectory()) walkDir(full);
        else if (full.endsWith('.ts')) files.push(full);
      }
    };
    walkDir(root);
    expect(files.length).toBeGreaterThan(8);
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/Math\.random|\bDate\b|\bperformance\b/);
    }
  });
});
