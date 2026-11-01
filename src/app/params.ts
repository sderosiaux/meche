// URL parameters: seed, bots (1–3), level (moyen by default | facile), autostart=1, debug=1,
// fixture=<name>, opponents=idle (debug only).
import type { BotLevel } from '../bots/api';

export interface AppParams {
  readonly seed: number;
  readonly bots: 1 | 2 | 3;
  readonly level: BotLevel;
  readonly autostart: boolean;
  readonly debug: boolean;
  readonly fixture: string | null;
  /** Debug only: 'idle' replaces the bots with opponents that never move. */
  readonly opponents: 'bots' | 'idle';
  /** Fixture only: freeze the fixture clock at this many seconds (deterministic screenshots). */
  readonly at: number | null;
}

export function readParams(search: string): AppParams {
  const q = new URLSearchParams(search);
  const seedRaw = q.get('seed');
  const seed = seedRaw !== null && /^\d+$/.test(seedRaw) ? Number(seedRaw) >>> 0 : (Math.random() * 2 ** 32) >>> 0;
  const botsRaw = Number(q.get('bots') ?? '3');
  const bots = (botsRaw === 1 || botsRaw === 2 || botsRaw === 3 ? botsRaw : 3) as 1 | 2 | 3;
  const level: BotLevel = q.get('level') === 'facile' ? 'facile' : 'moyen';
  return {
    seed,
    bots,
    level,
    autostart: q.get('autostart') === '1',
    debug: q.get('debug') === '1',
    fixture: q.get('fixture'),
    opponents: q.get('opponents') === 'idle' ? 'idle' : 'bots',
    at: q.get('at') !== null && Number.isFinite(Number(q.get('at'))) ? Number(q.get('at')) : null,
  };
}
