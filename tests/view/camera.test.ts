import { describe, expect, it } from 'vitest';
import { cameraRelativeDir } from '../../src/input/camera';
import { snapQuarter } from '../../src/render/camera';

const deg = (d: number) => (d * Math.PI) / 180;

describe('camera-relative controls (spec §20)', () => {
  it('leaves directions alone at the default view', () => {
    for (const d of ['up', 'down', 'left', 'right'] as const) expect(cameraRelativeDir(d, 0)).toBe(d);
    expect(cameraRelativeDir(null, 1)).toBeNull();
  });

  it('turns "up" toward the back of the screen when the camera has turned', () => {
    // Camera a quarter turn round to the right side of the board (+x): the back of the screen is -x.
    expect(cameraRelativeDir('up', 1)).toBe('left');
    expect(cameraRelativeDir('right', 1)).toBe('up');
    expect(cameraRelativeDir('down', 1)).toBe('right');
    expect(cameraRelativeDir('left', 1)).toBe('down');
    // Opposite side: everything flips.
    expect(cameraRelativeDir('up', 2)).toBe('down');
    expect(cameraRelativeDir('left', 2)).toBe('right');
    expect(cameraRelativeDir('up', 3)).toBe('right');
    expect(cameraRelativeDir('up', -1)).toBe('right');
  });

  it('snaps the camera yaw to quarter turns with hysteresis around 45°', () => {
    expect(snapQuarter(deg(10), 0)).toBe(0);
    expect(snapQuarter(deg(45), 0)).toBe(0); // exactly between: keep the current mapping
    expect(snapQuarter(deg(50), 0)).toBe(0);
    expect(snapQuarter(deg(60), 0)).toBe(1);
    expect(snapQuarter(deg(45), 1)).toBe(1); // coming back: still the new mapping
    expect(snapQuarter(deg(30), 1)).toBe(0);
    expect(snapQuarter(deg(-90), 0)).toBe(3);
    expect(snapQuarter(deg(720 + 180), 0)).toBe(2);
  });
});
