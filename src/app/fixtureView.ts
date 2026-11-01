// Static rendering of a fixture (?fixture=name[&at=seconds]): no simulation, no input, no bots.
// With `at`, the fixture clock is frozen there so screenshots are deterministic; motion-based
// visuals (ash) are rebuilt by replaying the last half second at 60 Hz once.
import { Renderer } from '../render/renderer';
import type { GameState } from '../sim/types';
import type { Fixture } from './fixtures';

export function runFixture(stage: HTMLElement, fixture: Fixture, at: number | null): void {
  const renderer = new Renderer(stage);
  let state: GameState = fixture.state;
  let prev: GameState | null = null;
  renderer.resetRound(state);

  if (at !== null) {
    const from = Math.max(0, at - 0.5);
    let fired = false;
    for (let now = from; now <= at; now += 1 / 60) {
      if (fixture.animate) {
        prev = state;
        state = fixture.animate(now, state);
      }
      if (fixture.loopEvents && !fired && now >= at - 0.3) {
        fired = true;
        renderer.onEvents(state, fixture.loopEvents, now);
      }
      renderer.render(state, prev, 1, 1 / 60, now);
    }
    const hold = () => {
      renderer.render(state, prev, 1, 0, at);
      requestAnimationFrame(hold);
    };
    requestAnimationFrame(hold);
    (window as unknown as { __fixtureReady: boolean }).__fixtureReady = true;
    return;
  }

  let start = 0;
  let last = 0;
  let lastLoop = -Infinity;
  const frame = (ms: number) => {
    if (start === 0) start = ms;
    const now = (ms - start) / 1000;
    const dt = last === 0 ? 0 : Math.min(0.1, (ms - last) / 1000);
    last = ms;
    if (fixture.animate) {
      prev = state;
      state = fixture.animate(now, state);
    }
    if (fixture.loopEvents && now - lastLoop >= (fixture.loopSeconds ?? 2)) {
      lastLoop = now;
      renderer.onEvents(state, fixture.loopEvents, now);
    }
    renderer.render(state, prev, 1, dt, now);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  (window as unknown as { __fixtureReady: boolean }).__fixtureReady = true;
}
