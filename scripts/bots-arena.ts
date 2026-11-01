// Headless bot-vs-bot rounds through the real sim. Usage:
//   pnpm bots --rounds 200 --levels moyen,moyen,moyen,moyen --seed 1 [--json]
import { performance } from 'node:perf_hooks';
import type { BotLevel } from '../src/bots/api';
import { createBot } from '../src/bots';
import { createRound, step } from '../src/sim';
import { TICK_HZ } from '../src/sim/constants';
import type { Explosion, GameState, PlayerId, PlayerInput } from '../src/sim/types';

interface Args {
  rounds: number;
  levels: BotLevel[];
  seed: number;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const levels = (get('levels') ?? 'moyen,moyen,moyen,moyen').split(',') as BotLevel[];
  if (levels.length < 2 || levels.length > 4 || levels.some((l) => l !== 'facile' && l !== 'moyen')) {
    throw new Error('--levels: 2 to 4 of facile|moyen');
  }
  return { rounds: Number(get('rounds') ?? 50), levels, seed: Number(get('seed') ?? 1), json: argv.includes('--json') };
}

type Cause = 'self' | 'hijacked' | 'other' | 'chain';

/** The fire-triggered explosion at the root of a chain. */
function rootOf(s: GameState, x: Explosion): Explosion {
  let cur = x;
  for (let guard = 0; cur.trigger.kind === 'chain' && guard < 50; guard++) {
    const byId = cur.trigger.byExplosion;
    const parent = s.explosions.find((e) => e.id === byId);
    if (!parent) break;
    cur = parent;
  }
  return cur;
}

function classify(s: GameState, victim: PlayerId, x: Explosion): { cause: Cause; hijack: boolean } {
  const root = rootOf(s, x);
  const igniter = root.trigger.kind === 'fire' ? root.trigger.ignition.by : null;
  const hijack = igniter !== null && igniter !== root.owner;
  if (x.owner === victim) return { cause: igniter === victim ? 'self' : 'hijacked', hijack };
  return { cause: x.trigger.kind === 'chain' ? 'chain' : 'other', hijack };
}

interface LevelStats {
  wins: number;
  deaths: number;
  causes: Record<Cause, number>;
  cordLengths: number[];
  bombs: number;
  aliveTicks: number;
}

const median = (xs: number[]): number => {
  if (!xs.length) return NaN;
  const a = [...xs].sort((p, q) => p - q);
  return a[Math.floor(a.length / 2)]!;
};

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const ids = args.levels.map((_, i) => i as PlayerId);
  const per: Record<BotLevel, LevelStats> = {
    facile: { wins: 0, deaths: 0, causes: { self: 0, hijacked: 0, other: 0, chain: 0 }, cordLengths: [], bombs: 0, aliveTicks: 0 },
    moyen: { wins: 0, deaths: 0, causes: { self: 0, hijacked: 0, other: 0, chain: 0 }, cordLengths: [], bombs: 0, aliveTicks: 0 },
  };
  const outcome = { winner: 0, simultaneous: 0, timeout: 0 };
  const durations: number[] = [];
  const decideMs: number[] = [];
  let hijackKills = 0;
  let exceptions = 0;
  let firstError: unknown = null;

  for (let r = 0; r < args.rounds; r++) {
    const seed = args.seed + r * 7919;
    try {
      let s = createRound({ seed, players: ids });
      const bots = ids.map((id) => createBot(id, args.levels[id]!, seed * 31 + id));
      let guard = 0;
      while (s.phase !== 'over') {
        if (++guard > 20000) throw new Error(`round ${seed} never ended`);
        const inputs: (PlayerInput | undefined)[] = [];
        for (const b of bots) {
          const t0 = performance.now();
          inputs[b.id] = b.decide(s);
          decideMs.push(performance.now() - t0);
        }
        s = step(s, inputs);
        const gameplay = s.phase === 'playing' || s.phase === 'resolving';
        for (const p of s.players) if (p && p.alive && gameplay && s.freeze === 0) per[args.levels[p.id]!].aliveTicks++;
        for (const e of s.events) {
          if (e.t === 'bomb-placed') per[args.levels[e.player]!].bombs++;
          if (e.t === 'cord-lit' && (e.ignition.kind === 'hand' || e.ignition.kind === 'max-length') && e.ignition.by !== null) {
            // A length-0 cord burns out within the same step and is already gone.
            const cord = s.cords.find((c) => c.id === e.cordId);
            per[args.levels[e.ignition.by]!].cordLengths.push(cord ? cord.nodes.length - 1 : 0);
          }
          if (e.t === 'player-died') {
            const x = s.explosions.find((ex) => ex.id === e.explosionId)!;
            const { cause, hijack } = classify(s, e.player, x);
            const st = per[args.levels[e.player]!];
            st.deaths++;
            st.causes[cause]++;
            if (hijack) hijackKills++;
          }
        }
      }
      durations.push(s.tick / TICK_HZ);
      const alive = s.players.filter((p) => p && p.alive).length;
      if (s.winner !== null) {
        outcome.winner++;
        per[args.levels[s.winner]!].wins++;
      }
      else if (alive >= 2) outcome.timeout++;
      else outcome.simultaneous++;
    } catch (err) {
      exceptions++;
      firstError ??= err;
    }
  }

  const sortedMs = [...decideMs].sort((a, b) => a - b);
  const summary = {
    rounds: args.rounds,
    levels: args.levels.join(','),
    exceptions,
    durationMeanS: durations.reduce((a, b) => a + b, 0) / Math.max(1, durations.length),
    durationMedianS: median(durations),
    winnerPct: (100 * outcome.winner) / args.rounds,
    timeoutPct: (100 * outcome.timeout) / args.rounds,
    simultaneousPct: (100 * outcome.simultaneous) / args.rounds,
    hijackKills,
    decideMeanMs: decideMs.reduce((a, b) => a + b, 0) / Math.max(1, decideMs.length),
    decideP95Ms: sortedMs[Math.floor(sortedMs.length * 0.95)] ?? 0,
    perLevel: Object.fromEntries(
      (Object.keys(per) as BotLevel[])
        .filter((l) => args.levels.includes(l))
        .map((l) => {
          const st = per[l];
          return [
            l,
            {
              wins: st.wins,
              deaths: st.deaths,
              selfPct: st.deaths ? (100 * st.causes.self) / st.deaths : 0,
              causes: st.causes,
              medianCordAtLight: median(st.cordLengths),
              lights: st.cordLengths.length,
              bombsPerBotMinute: st.aliveTicks ? (st.bombs * 60 * TICK_HZ) / st.aliveTicks : 0,
            },
          ];
        }),
    ),
  };
  if (args.json) {
    console.log(JSON.stringify(summary));
  } else {
    const f = (x: number): string => (Number.isFinite(x) ? x.toFixed(1) : 'n/a');
    console.log(`rounds ${summary.rounds} [${summary.levels}]  exceptions ${exceptions}`);
    console.log(`duration mean ${f(summary.durationMeanS)} s, median ${f(summary.durationMedianS)} s`);
    console.log(`outcome: winner ${f(summary.winnerPct)} %, timeout ${f(summary.timeoutPct)} %, simultaneous ${f(summary.simultaneousPct)} %`);
    console.log(`hijack kills ${hijackKills}`);
    console.log(`decide mean ${summary.decideMeanMs.toFixed(3)} ms, p95 ${summary.decideP95Ms.toFixed(3)} ms`);
    for (const [l, v] of Object.entries(summary.perLevel)) {
      const c = v.causes;
      console.log(
        `${l}: wins ${v.wins}, deaths ${v.deaths} (self ${c.self}, hijacked ${c.hijacked}, other ${c.other}, chain ${c.chain}) self ${f(v.selfPct)} %, ` +
          `median cord at light ${v.medianCordAtLight} (${v.lights} lights), bombs/bot-min ${f(v.bombsPerBotMinute)}`,
      );
    }
  }
  if (firstError) {
    console.error('first exception:', firstError);
    process.exitCode = 1;
  }
}

main();
