import { describe, expect, it } from 'vitest';
import { createBot } from '../../src/bots';
import type { BotLevel } from '../../src/bots/api';
import { crossOf } from '../../src/bots/world';
import { createRound, hashState, step, tileOf } from '../../src/sim';
import type { GameState, PlayerId, PlayerInput } from '../../src/sim/types';
import { at, events, idle, p, playing, press, tick, walk, type Run } from '../sim/helpers';

/** One tick where P0 is the bot and the others follow `others`. */
function botTick(run: Run, bot: ReturnType<typeof createBot>, others: Partial<Record<PlayerId, PlayerInput>> = {}): PlayerInput {
  const input = bot.decide(run.s);
  tick(run, { ...others, [bot.id]: input });
  return input;
}

function idleUntilFree(run: Run): void {
  // Let blasts/freeze from the staging settle so tests start from a quiet board.
  for (let i = 0; i < 200 && (run.s.blasts.length || run.s.freeze > 0); i++) idle(run, 1);
}

describe('bots: safety', () => {
  it.each<BotLevel>(['facile', 'moyen'])('%s never places a bomb when no escape exists', (level) => {
    const run = playing([0, 1], 3);
    // P0 boxed into (1,1)-(1,2): every tile it can reach is inside any cross it could make.
    run.s.cells[at(2, 1)] = 'crate';
    run.s.cells[at(1, 3)] = 'crate';
    const bot = createBot(0, level, 1);
    for (let i = 0; i < 600; i++) botTick(run, bot);
    expect(events(run, 'bomb-placed').filter((e) => e.player === 0)).toHaveLength(0);
    expect(p(run, 0).alive).toBe(true);
  });

  it.each<BotLevel>(['facile', 'moyen'])('%s flees a lit enemy bomb', (level) => {
    const run = playing([0, 1], 5);
    // P1 (scripted) bombs row 1 from (7,1), escapes to (8,3) and lights; the bot stands at (5,1), inside the cross.
    walk(run, 0, [[2, 1], [3, 1], [4, 1], [5, 1]]);
    walk(run, 1, [[12, 1], [11, 1], [10, 1], [9, 1], [8, 1], [7, 1]]);
    press(run, 1);
    walk(run, 1, [[7, 2], [7, 3], [8, 3]]);
    press(run, 1); // P1 lights: 3 tiles + bomb tile = 108 ticks
    const bot = createBot(0, level, 2);
    const lit = events(run, 'cord-lit').find((e) => e.ignition.by === 1);
    expect(lit).toBeDefined();
    for (let i = 0; i < 200; i++) botTick(run, bot);
    expect(run.s.deaths.filter((d) => d.player === 0)).toHaveLength(0);
    const p1Explosion = run.s.explosions.find((x) => x.owner === 1);
    expect(p1Explosion).toBeDefined();
    expect(p(run, 0).alive).toBe(true);
  });

  it('a bot lights its cord by hand only once out of its own cross', () => {
    let checked = 0;
    for (const seed of [11, 12, 13]) {
      let s: GameState = createRound({ seed, players: [0, 1, 2, 3] });
      const levels: BotLevel[] = ['facile', 'moyen', 'facile', 'moyen'];
      const bots = levels.map((l, i) => createBot(i as PlayerId, l, seed + i));
      for (let t = 0; t < 4000 && s.phase !== 'over'; t++) {
        const inputs = bots.map((b) => b.decide(s));
        for (const b of bots) {
          const me = s.players[b.id];
          if (!inputs[b.id]!.action || !me?.alive || me.heldCord === null || s.freeze > 0) continue;
          const cord = s.cords.find((c) => c.id === me.heldCord)!;
          const bomb = s.bombs.find((x) => x.id === cord.bombId)!;
          expect(crossOf(s, bomb.tile, me.range).has(tileOf(me.x, me.y))).toBe(false);
          checked++;
        }
        s = step(s, inputs);
      }
    }
    expect(checked).toBeGreaterThan(20);
  });
});

describe('bots: moyen tactics', () => {
  /** P0 bombs (3,1) and holds from (5,3), outside its cross; P1 waits at (8,1). */
  function holdingSetup(): Run {
    const run = playing([0, 1], 7);
    walk(run, 0, [[2, 1], [3, 1]]);
    press(run, 0);
    walk(run, 0, [[4, 1], [5, 1], [5, 2], [5, 3]]);
    walk(run, 1, [[12, 1], [11, 1], [10, 1], [9, 1], [8, 1]]);
    expect(p(run, 0).heldCord).not.toBeNull();
    return run;
  }

  it('holds while nobody comes, lights when an enemy steps into the cross', () => {
    const run = holdingSetup();
    const bot = createBot(0, 'moyen', 3);
    for (let i = 0; i < 60; i++) botTick(run, bot);
    expect(p(run, 0).heldCord).not.toBeNull();
    expect(events(run, 'cord-lit').filter((e) => e.ignition.by === 0)).toHaveLength(0);

    let enteredAt = -1;
    for (let i = 0; i < 80 && p(run, 0).heldCord !== null; i++) {
      botTick(run, bot, { 1: { dir: 'left', action: false } });
      if (enteredAt < 0 && tileOf(p(run, 1).x, p(run, 1).y) === at(5, 1)) enteredAt = run.s.tick;
    }
    const lit = events(run, 'cord-lit').find((e) => e.ignition.by === 0);
    expect(lit?.ignition.kind).toBe('hand');
    expect(enteredAt).toBeGreaterThan(0);
    expect(lit!.tick).toBeGreaterThanOrEqual(enteredAt);
    expect(lit!.tick - enteredAt).toBeLessThan(15);
  });

  it('hijacks: walks onto the cord of an enemy standing in its own cross and lights there', () => {
    const run = playing([0, 1], 9);
    // P1 bombs (7,5) and stays at (7,7), inside its own cross, holding.
    run.s.players[1]!.x = 7 * 960 + 480;
    run.s.players[1]!.y = 5 * 960 + 480;
    press(run, 1);
    walk(run, 1, [[7, 6], [7, 7]]);
    // P0 bombs (3,7) and escapes to (6,7), outside its own cross, next to P1's hand.
    run.s.players[0]!.x = 3 * 960 + 480;
    run.s.players[0]!.y = 7 * 960 + 480;
    press(run, 0);
    walk(run, 0, [[4, 7], [5, 7], [6, 7]]);
    idleUntilFree(run);

    const bot = createBot(0, 'moyen', 4);
    for (let i = 0; i < 260 && run.s.phase === 'playing'; i++) botTick(run, bot);

    const theirs = run.s.explosions.find((x) => x.owner === 1);
    expect(theirs).toBeDefined();
    expect(theirs!.trigger.kind === 'fire' && theirs!.trigger.ignition.by).toBe(0);
    expect(p(run, 1).alive).toBe(false);
    expect(p(run, 0).alive).toBe(true);
  });
});

describe('bots: determinism', () => {
  it('same seed and same states → same inputs and same round', () => {
    const play = (): { inputs: string; hash: string } => {
      let s = createRound({ seed: 21, players: [0, 1, 2] });
      const bots = [createBot(0, 'moyen', 9), createBot(1, 'facile', 9), createBot(2, 'moyen', 10)];
      const log: string[] = [];
      for (let t = 0; t < 3000 && s.phase !== 'over'; t++) {
        const inputs = bots.map((b) => b.decide(s));
        log.push(inputs.map((i) => `${i.dir ?? '-'}${i.action ? '!' : ''}`).join(','));
        s = step(s, inputs);
      }
      return { inputs: log.join('|'), hash: hashState(s) };
    };
    const a = play();
    const b = play();
    expect(b.inputs).toBe(a.inputs);
    expect(b.hash).toBe(a.hash);
  });

  it('bot sources use no ambient randomness or clock', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const dir = new URL('../../src/bots/', import.meta.url);
    for (const f of readdirSync(dir)) {
      const src = readFileSync(new URL(f, dir), 'utf8');
      expect(src, f).not.toMatch(/Math\.random|Date\.|performance\./);
    }
  });
});
