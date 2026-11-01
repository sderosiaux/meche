// Scene orchestration: a wooden toy board on a workbench in a warm workshop, lit by a window key
// light, seen through an orbit camera and a post chain (AO, bloom, tilt-shift, vignette).
// Adaptive quality drops resolution and effects if frames get slow.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { GameState, SimEvent } from '../sim/types';
import { Actors } from './actors';
import { workshopPanorama } from './assets';
import { Board } from './board';
import { CameraRig, type ScreenMargins } from './camera';
import { resolveDeathChain } from './chain';
import { Cords } from './cords';
import { Effects } from './effects';
import { palette } from './palette';
import { Post, QUALITIES, type Quality } from './post';
import { buildWorkbench } from './workbench';

export type { ScreenMargins } from './camera';

const SLOW_FRAME = 1 / 48; // seconds
const SLOW_FOR = 2; // seconds of slow frames before stepping quality down
const SETTLE = 3; // seconds ignored after start or resize (shader compilation)

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly rig: CameraRig;
  private readonly scene = new THREE.Scene();
  private readonly board = new Board();
  private readonly actors = new Actors();
  private readonly cords = new Cords();
  private readonly effects = new Effects();
  private readonly sun: THREE.DirectionalLight;
  private readonly post: Post;
  private quality: Quality = 'high';
  private auto = true;
  private frameAvg = 1 / 60;
  private slowTime = 0;
  private settle = SETTLE;
  private lastReal = 0;

  constructor(private readonly container: HTMLElement, margins: ScreenMargins = { top: 76, bottom: 16 }) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor(palette.background);
    container.appendChild(this.renderer.domElement);

    this.rig = new CameraRig(margins);
    this.rig.attach(this.renderer.domElement);

    // Neutral studio reflections until the workshop panorama has loaded.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    this.scene.background = new THREE.Color(palette.background);
    workshopPanorama((tex) => {
      this.scene.background = tex;
      this.scene.backgroundBlurriness = 0.45;
      this.scene.backgroundIntensity = 0.7;
      this.scene.environment = pmrem.fromEquirectangular(tex).texture;
      this.scene.environmentIntensity = 0.45;
    });

    const hemi = new THREE.HemisphereLight(palette.skyFill, palette.groundFill, 0.55);
    this.sun = new THREE.DirectionalLight(palette.sunlight, 2.6);
    this.sun.position.set(-11, 14, -3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -15;
    sc.right = 15;
    sc.top = 12;
    sc.bottom = -12;
    sc.near = 2;
    sc.far = 50;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 3;
    this.scene.add(hemi, this.sun, this.sun.target, buildWorkbench(), this.board.group, this.cords.group, this.actors.group, this.effects.group);

    this.post = new Post(this.renderer, this.scene, this.rig.camera);
    this.applyQuality('high');
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.prewarm();
  }

  /** Compile every shader up front (hidden sparks and effects included) so the first flame or
   * explosion of a round never stalls a frame. */
  private prewarm(): void {
    const hidden: THREE.Object3D[] = [];
    this.scene.traverse((o) => {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
    });
    this.renderer.compile(this.scene, this.rig.camera);
    for (const o of hidden) o.visible = false;
  }

  /** Quarter turns the controls must be rotated by (camera-relative input, spec §20). */
  get cameraQuarter(): number {
    return this.rig.quarter;
  }

  get qualityLabel(): string {
    return `${this.quality}${this.auto ? ' (auto)' : ''} · ${(1000 * this.frameAvg).toFixed(1)} ms`;
  }

  /** Debug: next quality tier, and stop adapting automatically. */
  cycleQuality(): void {
    this.auto = false;
    const i = QUALITIES.indexOf(this.quality);
    this.applyQuality(QUALITIES[(i + 1) % QUALITIES.length]!);
  }

  resetRound(state: GameState): void {
    this.board.rebuild(state.cells);
    this.actors.reset(state);
    this.cords.reset();
    this.effects.reset();
  }

  /** One-shot visuals from sim events. */
  onEvents(state: GameState, events: readonly SimEvent[], nowSec: number): void {
    let cratesChanged = false;
    for (const e of events) {
      if (e.t === 'crate-destroyed') {
        this.effects.crateBurst(e.tile, nowSec);
        cratesChanged = true;
      } else if (e.t === 'explosion') {
        this.rig.kick();
      } else if (e.t === 'player-died') {
        const ex = state.explosions.find((x) => x.id === e.explosionId);
        this.actors.startDeath(e.player, ex?.tile ?? 0, nowSec);
        this.effects.showChain(resolveDeathChain(state, e.explosionId), nowSec);
      }
    }
    if (cratesChanged) this.board.rebuild(state.cells);
  }

  render(state: GameState, prev: GameState | null, alpha: number, dt: number, nowSec: number): void {
    const now = performance.now() / 1000;
    const real = this.lastReal === 0 ? 0 : Math.min(0.1, now - this.lastReal);
    this.lastReal = now;

    this.actors.update(state, prev, alpha, nowSec);
    const fire = this.cords.update(state, prev, alpha, this.actors.hands, nowSec);
    this.effects.update(state, fire, dt, nowSec);
    this.rig.update(real);
    const f = this.rig.focus;
    this.post.setFocusRect(f.x, f.y, f.z, f.w);
    this.post.render(real);
    this.adapt(real);
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(Post.pixelRatio(this.quality));
    this.renderer.setSize(w, h);
    this.post.setSize(w, h);
    this.rig.resize(w, h);
    const pr = this.renderer.getPixelRatio();
    this.effects.setPointScale((h * pr) / (2 * Math.tan(THREE.MathUtils.degToRad(this.rig.camera.fov / 2))));
    this.settle = SETTLE;
  }

  private applyQuality(q: Quality): void {
    this.quality = q;
    this.post.setQuality(q);
    const size = q === 'low' ? 1024 : 2048;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.resize();
  }

  private adapt(real: number): void {
    if (real <= 0 || document.visibilityState !== 'visible') return;
    this.frameAvg = this.frameAvg * 0.95 + real * 0.05;
    if (this.settle > 0) {
      this.settle -= real;
      this.slowTime = 0;
      return;
    }
    if (!this.auto || this.quality === 'low') return;
    this.slowTime = this.frameAvg > SLOW_FRAME ? this.slowTime + real : 0;
    if (this.slowTime > SLOW_FOR) {
      this.slowTime = 0;
      this.applyQuality(this.quality === 'high' ? 'medium' : 'low');
    }
  }
}
