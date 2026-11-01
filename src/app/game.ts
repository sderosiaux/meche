// The running app: menu → rounds → match over. Fixed 60 Hz simulation with render interpolation;
// the human (P0) and the bots feed the same TickInputs into the pure sim step.
import type { Bot, CreateBot } from '../bots/api';
import { AudioEngine } from '../audio/engine';
import { cameraRelativeDir } from '../input/camera';
import { Input, type UiKey } from '../input/input';
import { Renderer } from '../render/renderer';
import { createRound, step } from '../sim';
import { TICK_HZ } from '../sim/constants';
import type { Dir, GameState, PlayerInput, TickInputs } from '../sim/types';
import { Hud, type MenuChoice } from './hud';
import { afterInterlude, HUMAN, matchPlayers, matchSeed, newMatch, recordRound, roundSeed, type MatchState } from './match';
import { humanInputFor } from './tickGate';
import type { AppParams } from './params';

const TICK_SEC = 1 / TICK_HZ;
const MAX_TICKS_PER_FRAME = 5;
const INTERLUDE_SEC = 2.5;

type Mode = 'menu' | 'playing' | 'interlude' | 'matchover';

export interface ScriptStep {
  readonly dir: Dir | null;
  readonly action?: boolean;
  readonly ticks: number;
}

/** Scripted P1 inputs for automated checks (debug=1). Action fires on the first tick of a step. */
class ScriptQueue {
  private steps: { dir: Dir | null; action: boolean; left: number; started: boolean }[] = [];

  push(steps: readonly ScriptStep[]): void {
    for (const s of steps) this.steps.push({ dir: s.dir, action: s.action ?? false, left: Math.max(1, s.ticks), started: false });
  }

  get active(): boolean {
    return this.steps.length > 0;
  }

  next(): PlayerInput | null {
    const s = this.steps[0];
    if (!s) return null;
    const action = s.action && !s.started;
    s.started = true;
    s.left--;
    if (s.left <= 0) this.steps.shift();
    return { dir: s.dir, action };
  }
}

export class Game {
  private readonly renderer: Renderer;
  private readonly hud: Hud;
  private readonly input: Input;
  private readonly audio = new AudioEngine();
  private readonly script = new ScriptQueue();
  private mode: Mode = 'menu';
  private paused = false;
  private choice: MenuChoice;
  private match: MatchState | null = null;
  private state: GameState | null = null;
  private prev: GameState | null = null;
  private bots: Bot[] = [];
  private acc = 0;
  private clock = 0; // game seconds, stops while paused
  private lastFrame = 0;
  private interludeLeft = 0;
  private timeScale = 1;
  private fps = 0;
  private stepMs = 0;
  private matchIndex = 0;
  private lastError = '';

  constructor(
    stage: HTMLElement,
    hudRoot: HTMLElement,
    private readonly params: AppParams,
    private readonly createOpponent: CreateBot,
  ) {
    this.renderer = new Renderer(stage);
    this.hud = new Hud(hudRoot);
    this.input = new Input();
    this.choice = { bots: params.bots, level: params.level };
    this.hud.debugVisible = params.debug;
    this.input.onGesture(() => this.audio.unlock());
    this.input.onUi((k) => this.onUi(k));
    this.hud.onOverlayClick((c) => this.onMenuChoice(c));
    if (params.debug) this.exposeDebug();
    document.addEventListener('visibilitychange', () => this.onVisibility());
    if (params.autostart) this.startMatch();
    else this.hud.showMenu(this.choice);
    requestAnimationFrame((t) => this.frame(t));
  }

  /** Hidden tab: pause the game and silence it. Visible again: sound comes back, the player unpauses. */
  private onVisibility(): void {
    if (document.visibilityState === 'hidden') {
      this.audio.suspend();
      this.pauseFor('hidden');
    } else {
      this.audio.resume();
    }
  }

  private pauseFor(reason: 'player' | 'hidden' | 'gamepad'): void {
    if (this.paused || (this.mode !== 'playing' && this.mode !== 'interlude')) return;
    this.paused = true;
    this.hud.showPause(reason);
    this.input.flush();
  }

  private startMatch(): void {
    const seed = matchSeed(this.params.seed, this.matchIndex++);
    this.match = newMatch({ seed, bots: this.choice.bots, level: this.choice.level });
    this.hud.hideOverlay();
    this.paused = false;
    this.startRound();
  }

  private startRound(): void {
    const match = this.match!;
    const seed = roundSeed(match.setup.seed, match.round);
    const players = matchPlayers(match.setup);
    this.state = createRound({ seed, players });
    this.prev = null;
    this.bots = players
      .filter((id) => id !== HUMAN)
      .map((id) => this.createOpponent(id, match.setup.level, (seed ^ Math.imul(id, 0x2545f491)) >>> 0));
    this.renderer.resetRound(this.state);
    this.hud.showResult(undefined);
    this.input.flush();
    this.acc = 0;
    this.mode = 'playing';
  }

  private frame(nowMs: number): void {
    // Re-arm first: an exception below must never stop the loop silently.
    requestAnimationFrame((t) => this.frame(t));
    try {
      this.frameBody(nowMs);
    } catch (err) {
      this.fail(err);
    }
  }

  private fail(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    if (message !== this.lastError) {
      this.lastError = message;
      console.error('[meche] frame failed', err);
    }
    this.paused = true;
    this.hud.showError(message);
  }

  private frameBody(nowMs: number): void {
    const dt = this.lastFrame === 0 ? 0 : Math.min(0.1, (nowMs - this.lastFrame) / 1000);
    this.lastFrame = nowMs;
    if (dt > 0) this.fps = this.fps * 0.92 + (1 / dt) * 0.08;
    this.input.pollGamepads();
    const orbit = this.input.orbitAxes;
    if (orbit.x !== 0 || orbit.y !== 0) this.renderer.rig.orbit(orbit.x, orbit.y, dt);

    const running = !this.paused && (this.mode === 'playing' || this.mode === 'interlude');
    if (running) this.clock += dt;
    if (this.mode === 'playing' && !this.paused) {
      this.acc += dt * this.timeScale;
      let n = 0;
      while (this.acc >= TICK_SEC && n < MAX_TICKS_PER_FRAME * Math.max(1, this.timeScale) && this.mode === 'playing') {
        this.tick();
        this.acc -= TICK_SEC;
        n++;
      }
      if (this.acc >= TICK_SEC) this.acc = 0; // too far behind: drop time rather than spiral
    } else if (this.mode === 'interlude' && !this.paused) {
      this.interludeLeft -= dt;
      if (this.interludeLeft <= 0) this.endInterlude();
    }

    if (this.state) {
      const alpha = this.mode === 'playing' ? Math.min(1, this.acc / TICK_SEC) : 1;
      this.renderer.render(this.state, this.prev, alpha, running ? dt : 0, this.clock);
    }
    this.audio.update(this.state, running && this.mode === 'playing');
    this.hud.update(this.state, this.match);
    this.hud.setDebug(this.hud.debugVisible ? this.debugText() : null);
  }

  private tick(): void {
    const state = this.state!;
    const inputs: (PlayerInput | undefined)[] = [undefined, undefined, undefined, undefined];
    // Only sample (and consume the latched action) on ticks the sim actually reads.
    // Scripted steps (debug) are in board directions; live input follows the camera (spec §20).
    inputs[HUMAN] = humanInputFor(state, () => this.script.next() ?? this.cameraRelative(this.input.sample()));
    for (const bot of this.bots) inputs[bot.id] = bot.decide(state);
    const t0 = performance.now();
    const next = step(state, inputs as TickInputs);
    this.stepMs = this.stepMs * 0.95 + (performance.now() - t0) * 0.05;
    this.prev = state;
    this.state = next;
    if (next.events.length > 0) {
      this.renderer.onEvents(next, next.events, this.clock);
      this.audio.events(next, next.events);
    }
    if (next.phase === 'over') {
      this.match = recordRound(this.match!, next.winner);
      this.hud.showResult(next.winner);
      this.mode = 'interlude';
      this.interludeLeft = INTERLUDE_SEC;
    }
  }

  private cameraRelative(input: PlayerInput): PlayerInput {
    const dir = cameraRelativeDir(input.dir, this.renderer.cameraQuarter);
    return dir === input.dir ? input : { dir, action: input.action };
  }

  private endInterlude(): void {
    const match = this.match!;
    if (afterInterlude(match) === 'match-over' && match.champion !== null) {
      this.mode = 'matchover';
      this.audio.matchWon();
      this.hud.showResult(undefined);
      this.hud.showMatchOver(match.champion, match);
    } else {
      this.startRound();
    }
  }

  private onUi(key: UiKey): void {
    if (key === 'mute') {
      this.audio.toggleMute();
      return;
    }
    if (key === 'debug') {
      this.hud.debugVisible = !this.hud.debugVisible;
      return;
    }
    // Camera keys work everywhere (menu, play, pause): R recentres, Q/E turn by 45°.
    if (key === 'recenter') {
      this.renderer.rig.reset();
      return;
    }
    if (key === 'cam-left' || key === 'cam-right') {
      this.renderer.rig.rotateStep(key === 'cam-left' ? 1 : -1);
      return;
    }
    if (key === 'quality') {
      this.renderer.cycleQuality();
      return;
    }
    if (this.mode === 'menu') {
      if (key === 'left' || key === 'right') {
        const n = this.choice.bots + (key === 'right' ? 1 : -1);
        this.choice = { ...this.choice, bots: (Math.min(3, Math.max(1, n)) as 1 | 2 | 3) };
        this.audio.ui('move');
        this.hud.showMenu(this.choice);
      } else if (key === 'up' || key === 'down') {
        this.choice = { ...this.choice, level: this.choice.level === 'facile' ? 'moyen' : 'facile' };
        this.audio.ui('move');
        this.hud.showMenu(this.choice);
      } else if (key === 'confirm') {
        this.audio.ui('select');
        this.startMatch();
      }
      return;
    }
    if (this.mode === 'matchover') {
      if (key === 'confirm') {
        this.audio.ui('select');
        this.startMatch();
      }
      return;
    }
    if (key === 'pad-lost') {
      this.pauseFor('gamepad');
      return;
    }
    if (key === 'pause') {
      if (this.paused) {
        this.paused = false;
        this.audio.ui('back');
        this.hud.hideOverlay();
        this.input.flush();
      } else {
        this.audio.ui('select');
        this.pauseFor('player');
      }
      return;
    }
    // Backspace restarts the match from the pause card (R is "recentre the view", spec §20).
    if (this.paused && key === 'restart') {
      this.audio.ui('select');
      this.startMatch();
    }
  }

  private onMenuChoice(c: string): void {
    if (this.mode !== 'menu') return;
    if (c === 'play') {
      this.audio.ui('select');
      return this.startMatch();
    }
    this.audio.ui('move');
    const [k, v] = c.split(':');
    if (k === 'bots') this.choice = { ...this.choice, bots: Number(v) as 1 | 2 | 3 };
    if (k === 'level') this.choice = { ...this.choice, level: v === 'facile' ? 'facile' : 'moyen' };
    this.hud.showMenu(this.choice);
  }

  private debugText(): string | null {
    const s = this.state;
    if (!s) return `mode ${this.mode} · fps ${this.fps.toFixed(0)}`;
    return [
      `fps ${this.fps.toFixed(0)} · step ${this.stepMs.toFixed(3)} ms`,
      `tick ${s.tick} · ${s.phase}${s.freeze > 0 ? ' (freeze)' : ''} · mode ${this.mode}${this.paused ? ' (paused)' : ''}`,
      `seed ${this.match?.setup.seed ?? '-'} · round ${this.match?.round ?? '-'} · wins ${this.match?.wins.join('/') ?? '-'}`,
      `bombs ${s.bombs.length} · cords ${s.cords.length} · fronts ${s.fronts.length} · blasts ${s.blasts.length}`,
      `quality ${this.renderer.qualityLabel} (F2) · view ¼×${this.renderer.cameraQuarter}`,
    ].join('\n');
  }

  private exposeDebug(): void {
    const api = {
      getState: () => this.state,
      queueP1: (steps: readonly ScriptStep[]) => this.script.push(steps),
      scriptActive: () => this.script.active,
      pause: (on: boolean) => {
        this.paused = on;
      },
      timeScale: (n: number) => {
        this.timeScale = Math.max(0.1, Math.min(16, n));
      },
      info: () => ({ mode: this.mode, paused: this.paused, round: this.match?.round ?? null, wins: this.match?.wins ?? null, fps: this.fps, stepMs: this.stepMs }),
      start: () => this.startMatch(),
      camera: {
        rotate: (steps: number) => {
          for (let i = 0; i < Math.abs(steps); i++) this.renderer.rig.rotateStep(steps > 0 ? 1 : -1);
        },
        orbit: (x: number, y: number, seconds: number) => this.renderer.rig.orbit(x, y, seconds),
        reset: () => this.renderer.rig.reset(),
        quarter: () => this.renderer.cameraQuarter,
      },
      quality: (q?: 'high' | 'medium' | 'low') => {
        if (q) while (!this.renderer.qualityLabel.startsWith(q)) this.renderer.cycleQuality();
        return this.renderer.qualityLabel;
      },
    };
    (window as unknown as { __meche: typeof api }).__meche = api;
  }
}
