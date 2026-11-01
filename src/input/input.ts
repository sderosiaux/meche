// Keyboard (by physical key code, so ZQSD on AZERTY and WASD on QWERTY are the same keys) and
// gamepad, merged into P1's input. A second human would take the arrows + Enter; the prototype
// has one human, so arrows and Enter also drive P1.
import type { Dir, PlayerInput } from '../sim/types';
import { ActionLatch, DirStack, makeInput } from './controls';

const KEY_DIRS: Record<string, Dir> = {
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};
const ACTION_KEYS = new Set(['Space', 'Enter', 'NumpadEnter']);
const SCROLL_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F1', 'F2', 'Backspace']);
const STICK_DEADZONE = 0.5;
const ORBIT_DEADZONE = 0.2;

/** Physical code of a key event; falls back on `key` when a synthetic event leaves `code` empty. */
export function keyCode(e: Pick<KeyboardEvent, 'code' | 'key'>): string {
  if (e.code) return e.code;
  if (e.key === ' ') return 'Space';
  if (/^[a-z]$/i.test(e.key)) return `Key${e.key.toUpperCase()}`;
  if (e.key === '`') return 'Backquote';
  return e.key;
}

export type UiKey =
  | 'pause'
  | 'mute'
  | 'debug'
  | 'quality'
  | 'confirm'
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'restart'
  | 'pad-lost'
  | 'cam-left'
  | 'cam-right'
  | 'recenter';

export class Input {
  private readonly dirs = new DirStack();
  private readonly action = new ActionLatch();
  private padDir: Dir | null = null;
  /** Right stick, for orbiting the camera (spec §20). */
  readonly orbitAxes = { x: 0, y: 0 };
  private padButtons: boolean[] = [];
  /** Index of the gamepad that has driven P1 (spec §26: its disconnection pauses the game). */
  private activePad: number | null = null;
  private readonly listeners: ((key: UiKey) => void)[] = [];
  private readonly gestureListeners: (() => void)[] = [];

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => this.onKeyDown(e));
    target.addEventListener('keyup', (e) => {
      const d = KEY_DIRS[keyCode(e)];
      if (d) this.dirs.release(d);
    });
    target.addEventListener('blur', () => this.dirs.clear());
    target.addEventListener('pointerdown', () => this.gesture());
    target.addEventListener('gamepaddisconnected', (e) => {
      if (this.activePad !== null && (e as GamepadEvent).gamepad.index === this.activePad) {
        this.activePad = null;
        this.padDir = null;
        this.padButtons = [];
        this.emit('pad-lost');
      }
    });
  }

  onUi(fn: (key: UiKey) => void): void {
    this.listeners.push(fn);
  }

  /** First user gesture (needed to unlock audio). */
  onGesture(fn: () => void): void {
    this.gestureListeners.push(fn);
  }

  /** P1 input for the coming tick; consumes the latched action. */
  sample(): PlayerInput {
    return makeInput(this.dirs.current() ?? this.padDir, this.action.consume());
  }

  /** Drop anything latched (between rounds, after menus). */
  flush(): void {
    this.action.clear();
  }

  /** Poll gamepads once per frame. */
  pollGamepads(): void {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    const pad = [...pads].find((p): p is Gamepad => p !== null && p.connected);
    if (!pad) {
      this.padDir = null;
      this.orbitAxes.x = 0;
      this.orbitAxes.y = 0;
      return;
    }
    const pressed = (i: number) => pad.buttons[i]?.pressed ?? false;
    const ax = pad.axes[0] ?? 0;
    const ay = pad.axes[1] ?? 0;
    let dir: Dir | null = null;
    if (pressed(12)) dir = 'up';
    else if (pressed(13)) dir = 'down';
    else if (pressed(14)) dir = 'left';
    else if (pressed(15)) dir = 'right';
    else if (Math.max(Math.abs(ax), Math.abs(ay)) > STICK_DEADZONE) dir = Math.abs(ax) > Math.abs(ay) ? (ax > 0 ? 'right' : 'left') : ay > 0 ? 'down' : 'up';
    this.padDir = dir;
    const rx = pad.axes[2] ?? 0;
    const ry = pad.axes[3] ?? 0;
    this.orbitAxes.x = Math.abs(rx) > ORBIT_DEADZONE ? rx : 0;
    this.orbitAxes.y = Math.abs(ry) > ORBIT_DEADZONE ? ry : 0;

    const now = pad.buttons.map((b) => b.pressed);
    if (dir !== null || now.some(Boolean)) this.activePad = pad.index;
    const edge = (i: number) => (now[i] ?? false) && !(this.padButtons[i] ?? false);
    if (edge(0)) {
      this.gesture();
      this.action.press();
      this.emit('confirm');
    }
    if (edge(9)) this.emit('pause');
    if (edge(4)) this.emit('cam-left');
    if (edge(5)) this.emit('cam-right');
    if (edge(11)) this.emit('recenter');
    if (edge(12)) this.emit('up');
    if (edge(13)) this.emit('down');
    if (edge(14)) this.emit('left');
    if (edge(15)) this.emit('right');
    this.padButtons = now;
  }

  private onKeyDown(e: KeyboardEvent): void {
    const code = keyCode(e);
    if (SCROLL_KEYS.has(code)) e.preventDefault();
    this.gesture();
    if (e.repeat) return;
    const d = KEY_DIRS[code];
    if (d) {
      this.dirs.press(d);
      this.emit(d);
    }
    if (ACTION_KEYS.has(code)) {
      this.action.press();
      this.emit('confirm');
    }
    if (code === 'Escape') this.emit('pause');
    if (code === 'KeyM') this.emit('mute');
    if (code === 'F1' || code === 'Backquote') this.emit('debug');
    if (code === 'F2') this.emit('quality');
    // Q/E by physical position (A/E on AZERTY): they never clash with the WASD/ZQSD movement keys.
    if (code === 'KeyQ') this.emit('cam-left');
    if (code === 'KeyE') this.emit('cam-right');
    if (code === 'KeyR') this.emit('recenter');
    if (code === 'Backspace') this.emit('restart');
  }

  private emit(key: UiKey): void {
    for (const fn of this.listeners) fn(key);
  }

  private gesture(): void {
    for (const fn of this.gestureListeners) fn();
  }
}
