// Orbit camera around the board (spec §20): drag to rotate, wheel to zoom, Q/E keys in 45° steps,
// gamepad right stick, reset to the default framing. Limits keep the board readable: no grazing
// view, no view from below, no panning. A vertical lens shift keeps the board centred in the band
// left free by the HUD, whatever the angle.
import * as THREE from 'three';
import { GRID_H, GRID_W } from '../sim/constants';

export const DEFAULT_POLAR = THREE.MathUtils.degToRad(32); // 58° below the horizon
const MIN_POLAR = THREE.MathUtils.degToRad(20);
const MAX_POLAR = THREE.MathUtils.degToRad(65);
const STEP = Math.PI / 4;
const FOV = 30;
const DAMP = 9; // 1/s
const QUARTER = Math.PI / 2;
/** Hysteresis on the 90° snap used by the controls: change only past 45° + this margin. */
const SNAP_MARGIN = THREE.MathUtils.degToRad(8);
const MIN_ZOOM = 0.55;
const MAX_ZOOM = 1.3;

export interface ScreenMargins {
  /** CSS pixels kept free at the top for the HUD strip. */
  readonly top: number;
  readonly bottom: number;
}

/** Nearest quarter turn of `azimuth`, keeping `current` until the camera is clearly past 45°. */
export function snapQuarter(azimuth: number, current: number): number {
  const delta = Math.atan2(Math.sin(azimuth - current * QUARTER), Math.cos(azimuth - current * QUARTER));
  if (Math.abs(delta) <= Math.PI / 4 + SNAP_MARGIN) return current;
  return (((Math.round(azimuth / QUARTER) % 4) + 4) % 4) as number;
}

export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 400);
  private readonly target = new THREE.Vector3(0, 0.15, 0);
  private az = 0;
  private pol = DEFAULT_POLAR;
  /** Zoom as a factor of the distance that fits the board at the current angles. */
  private zoom = 1;
  private azT = 0;
  private polT = DEFAULT_POLAR;
  private zoomT = 1;
  private quarterIndex = 0;
  private pulse = 0;
  private width = 1;
  private height = 1;
  private readonly corners: THREE.Vector3[] = [];
  private readonly focusCorners: THREE.Vector3[] = [];
  private readonly p = new THREE.Vector3();
  /** Board rectangle in UV space (x0, y0, x1, y1) after the last update, for the tilt-shift. */
  readonly focus = new THREE.Vector4(0, 0, 1, 1);
  private dragging: { x: number; y: number; id: number } | null = null;

  constructor(private readonly margins: ScreenMargins = { top: 76, bottom: 16 }) {
    const hw = GRID_W / 2 + 0.2;
    const hd = GRID_H / 2 + 0.2;
    for (const x of [-hw, hw]) for (const y of [0, 0.8]) for (const z of [-hd, hd]) this.corners.push(new THREE.Vector3(x, y, z));
    for (const x of [-hw - 0.3, hw + 0.3]) for (const y of [-0.5, 1.2]) for (const z of [-hd - 0.3, hd + 0.3]) this.focusCorners.push(new THREE.Vector3(x, y, z));
  }

  /** Quarter turns (0..3) the controls are rotated by: "up" moves toward the back of the screen. */
  get quarter(): number {
    return this.quarterIndex;
  }

  get azimuth(): number {
    return this.az;
  }

  attach(dom: HTMLElement): void {
    dom.style.touchAction = 'none';
    dom.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      this.dragging = { x: e.clientX, y: e.clientY, id: e.pointerId };
      dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener('pointermove', (e) => {
      if (!this.dragging || e.pointerId !== this.dragging.id) return;
      const dx = e.clientX - this.dragging.x;
      const dy = e.clientY - this.dragging.y;
      this.dragging.x = e.clientX;
      this.dragging.y = e.clientY;
      this.azT -= dx * 0.006;
      this.polT = THREE.MathUtils.clamp(this.polT - dy * 0.004, MIN_POLAR, MAX_POLAR);
    });
    const end = (e: PointerEvent) => {
      if (this.dragging && e.pointerId === this.dragging.id) this.dragging = null;
    };
    dom.addEventListener('pointerup', end);
    dom.addEventListener('pointercancel', end);
    dom.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoomT = THREE.MathUtils.clamp(this.zoomT * Math.exp(e.deltaY * 0.0012), MIN_ZOOM, MAX_ZOOM);
      },
      { passive: false },
    );
    dom.addEventListener('dblclick', () => this.reset());
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Rotate the view by 45° steps (positive = counter-clockwise seen from above). */
  rotateStep(direction: 1 | -1): void {
    this.azT = Math.round(this.azT / STEP) * STEP + direction * STEP;
  }

  /** Continuous orbit from a stick, axes in -1..1. */
  orbit(x: number, y: number, dt: number): void {
    this.azT -= x * 2.4 * dt;
    this.polT = THREE.MathUtils.clamp(this.polT + y * 1.4 * dt, MIN_POLAR, MAX_POLAR);
  }

  reset(): void {
    // Shortest way back to the default azimuth.
    this.azT = this.az - Math.atan2(Math.sin(this.az), Math.cos(this.az));
    this.polT = DEFAULT_POLAR;
    this.zoomT = 1;
  }

  /** Zoom pulse on explosions (≤ 1 %, no shake). */
  kick(): void {
    this.pulse = 1;
  }

  resize(w: number, h: number): void {
    this.width = w;
    this.height = h;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-DAMP * dt);
    this.az += (this.azT - this.az) * k;
    this.pol += (this.polT - this.pol) * k;
    this.zoom += (this.zoomT - this.zoom) * k;
    this.pulse = Math.max(0, this.pulse - dt / 0.25);
    // The board keeps fitting the free band whatever the angle; zoom scales from there.
    const fit = this.fitDistance(this.az, this.pol);
    this.place(this.az, this.pol, fit * this.zoom * (1 - 0.01 * this.pulse));
    this.quarterIndex = snapQuarter(this.az, this.quarterIndex);
    this.centreInBand();
    this.computeFocus();
  }

  private place(az: number, pol: number, dist: number): void {
    const s = Math.sin(pol);
    this.camera.position.set(this.target.x + Math.sin(az) * s * dist, this.target.y + Math.cos(pol) * dist, this.target.z + Math.cos(az) * s * dist);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld(true);
  }

  private setShift(s: number): void {
    this.camera.updateProjectionMatrix();
    this.camera.projectionMatrix.elements[9] = -s;
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
  }

  private band(): { top: number; bottom: number; side: number } {
    return {
      top: 1 - (2 * this.margins.top) / this.height,
      bottom: -1 + (2 * this.margins.bottom) / this.height,
      side: 1 - 48 / this.width,
    };
  }

  private measure(): { minY: number; maxY: number; maxX: number } {
    let minY = Infinity;
    let maxY = -Infinity;
    let maxX = 0;
    for (const c of this.corners) {
      this.p.copy(c).project(this.camera);
      minY = Math.min(minY, this.p.y);
      maxY = Math.max(maxY, this.p.y);
      maxX = Math.max(maxX, Math.abs(this.p.x));
    }
    return { minY, maxY, maxX };
  }

  /** Shift the image vertically so the board's projection is centred in the free band. */
  private centreInBand(): void {
    this.setShift(0);
    const m = this.measure();
    const b = this.band();
    this.setShift((b.top + b.bottom) / 2 - (m.maxY + m.minY) / 2);
  }

  /** Distance at which the board fits the free band at these angles (lens shift excluded). */
  private fitDistance(az: number, pol: number): number {
    const b = this.band();
    let lo = 5;
    let hi = 160;
    this.setShift(0);
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      this.place(az, pol, mid);
      const m = this.measure();
      if (m.maxX <= b.side && m.maxY - m.minY <= b.top - b.bottom) hi = mid;
      else lo = mid;
    }
    return hi;
  }

  private computeFocus(): void {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const c of this.focusCorners) {
      this.p.copy(c).project(this.camera);
      x0 = Math.min(x0, this.p.x);
      x1 = Math.max(x1, this.p.x);
      y0 = Math.min(y0, this.p.y);
      y1 = Math.max(y1, this.p.y);
    }
    this.focus.set(x0 * 0.5 + 0.5, y0 * 0.5 + 0.5, x1 * 0.5 + 0.5, y1 * 0.5 + 0.5);
  }
}
