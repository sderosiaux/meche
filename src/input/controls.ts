// Pure input bookkeeping, shared by keyboard and gamepad (tested in tests/view).
import type { Dir, PlayerInput } from '../sim/types';

/** Held directions; the most recently pressed one wins, like in Bomberman. */
export class DirStack {
  private held: Dir[] = [];

  press(d: Dir): void {
    this.held = [...this.held.filter((x) => x !== d), d];
  }

  release(d: Dir): void {
    this.held = this.held.filter((x) => x !== d);
  }

  clear(): void {
    this.held = [];
  }

  current(): Dir | null {
    return this.held[this.held.length - 1] ?? null;
  }
}

/** Action edge latched until the next simulation tick consumes it, so a quick tap between ticks is never lost. */
export class ActionLatch {
  private pending = false;

  press(): void {
    this.pending = true;
  }

  consume(): boolean {
    const was = this.pending;
    this.pending = false;
    return was;
  }

  clear(): void {
    this.pending = false;
  }
}

export function makeInput(dir: Dir | null, action: boolean): PlayerInput {
  return { dir, action };
}
