// Danger and feedback visuals: flames on cords (spark + travelling warm light + smoke), blast
// crosses (glowing lethal tiles, flash light, embers, sawdust, splinters, tumbling crate blocks)
// and the death causal chain. Only fire and blasts are emissive orange-white (spec §17).
// Everything is pooled: no allocation per frame.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BLAST_TICKS } from '../sim/constants';
import type { GameState, PlayerId, Tile } from '../sim/types';
import { outlineTexture, sparkTexture } from './assets';
import { crateStack } from './board';
import type { DeathChain } from './chain';
import type { FirePoint } from './cordShapes';
import { tileWorldX, tileWorldZ } from './coords';
import { materials } from './materials';
import { palette, playerColor } from './palette';
import { Particles, type ParticleSpec } from './particles';

const MAX_SPARKS = 32;
const FIRE_LIGHTS = 4;
const FLASH_LIGHTS = 3;
const MAX_BLAST_TILES = 256;
const MAX_BLOCKS = 96;
const MAX_SPLINTERS = 160;
const MAX_OUTLINES = 128;
const MAX_STARS = 4;
const CHAIN_SECONDS = 1.4; // 0.4 s freeze + 1 s of reading time
const DEBRIS_SECONDS = 1.8;
const FLASH_SECONDS = 0.45;
/** Spark colour pushed above 1 so only fire crosses the bloom threshold. */
const SPARK_HDR = 4.5;
const BLAST_HDR = 3.2;

interface Debris {
  readonly p: THREE.Vector3;
  readonly v: THREE.Vector3;
  readonly r: THREE.Euler;
  readonly w: THREE.Vector3;
  readonly color: THREE.Color;
  born: number;
  sx: number;
  sy: number;
  sz: number;
  alive: boolean;
}

interface ChainView {
  readonly outlines: readonly { tile: Tile; bomb: boolean }[];
  readonly trail: readonly Tile[];
  readonly stars: DeathChain['stars'];
  readonly born: number;
}

interface Flash {
  readonly light: THREE.PointLight;
  born: number;
  power: number;
}

function makeDebrisPool(n: number): Debris[] {
  const out: Debris[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), color: new THREE.Color(), born: 0, sx: 1, sy: 1, sz: 1, alive: false });
  }
  return out;
}

function takeOldest(pool: Debris[]): Debris {
  let best = pool[0]!;
  for (const d of pool) {
    if (!d.alive) return d;
    if (d.born < best.born) best = d;
  }
  return best;
}

export class Effects {
  readonly group = new THREE.Group();
  private readonly sparks: THREE.Sprite[] = [];
  private readonly sparkCores: THREE.Mesh[] = [];
  private readonly fireLights: THREE.PointLight[] = [];
  private readonly flashes: Flash[] = [];
  private readonly smoke = new Particles(320, false);
  private readonly embers = new Particles(320, true);
  private readonly lastPuff = new Map<number, number>();
  private readonly blastTiles: THREE.InstancedMesh;
  private readonly blastGlow: THREE.InstancedMesh;
  private readonly blocks: THREE.InstancedMesh;
  private readonly blockPool = makeDebrisPool(MAX_BLOCKS);
  private readonly splinters: THREE.InstancedMesh;
  private readonly splinterPool = makeDebrisPool(MAX_SPLINTERS);
  private readonly outlines: THREE.InstancedMesh;
  private readonly trailDots: THREE.InstancedMesh;
  private readonly stars: THREE.Mesh[] = [];
  private readonly starBacks: THREE.Mesh[] = [];
  private chain: ChainView | null = null;
  private readonly seenExplosions = new Set<number>();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();
  private readonly colCore = new THREE.Color(palette.blastCore).multiplyScalar(BLAST_HDR);
  private readonly colEdge = new THREE.Color(palette.blastEdge).multiplyScalar(BLAST_HDR * 0.8);
  private readonly colCool = new THREE.Color(palette.blastEdge).multiplyScalar(0.35);
  private readonly smokeRgb = new THREE.Color(palette.smoke);
  private readonly dustRgb = new THREE.Color(palette.sawdust);
  private readonly emberRgb = new THREE.Color(palette.spark);
  private readonly spec: ParticleSpec = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size0: 0, size1: 0, life: 1, r: 1, g: 1, b: 1, alpha: 1, gravity: 0, drag: 0 };

  constructor() {
    const mat = materials();
    const sparkMat = new THREE.SpriteMaterial({ map: sparkTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    sparkMat.color.setRGB(SPARK_HDR, SPARK_HDR * 0.85, SPARK_HDR * 0.6);
    const coreGeo = new THREE.SphereGeometry(0.06, 10, 8);
    const coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(palette.sparkCore).multiplyScalar(SPARK_HDR) });
    for (let i = 0; i < MAX_SPARKS; i++) {
      const sp = new THREE.Sprite(sparkMat);
      sp.visible = false;
      sp.renderOrder = 3;
      const core = new THREE.Mesh(coreGeo, coreMat);
      core.visible = false;
      this.sparks.push(sp);
      this.sparkCores.push(core);
      this.group.add(sp, core);
    }
    for (let i = 0; i < FIRE_LIGHTS; i++) {
      const l = new THREE.PointLight(palette.fireLight, 0, 4, 2);
      this.fireLights.push(l);
      this.group.add(l);
    }
    for (let i = 0; i < FLASH_LIGHTS; i++) {
      const l = new THREE.PointLight(palette.blastCore, 0, 7, 2);
      this.flashes.push({ light: l, born: -10, power: 0 });
      this.group.add(l);
    }
    this.group.add(this.smoke.points, this.embers.points);

    const plane = new THREE.PlaneGeometry(1, 1);
    plane.rotateX(-Math.PI / 2);
    this.blastTiles = new THREE.InstancedMesh(plane, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), MAX_BLAST_TILES);
    this.blastTiles.renderOrder = 2;
    const glowGeo = new THREE.SphereGeometry(0.5, 14, 10);
    this.blastGlow = new THREE.InstancedMesh(glowGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }), MAX_BLAST_TILES);
    this.blastGlow.renderOrder = 2;

    // Same painted wood as the crates, without their per-instance UV offset.
    const paint = new THREE.MeshStandardMaterial({ color: 0xffffff, map: mat.painted.map, normalMap: mat.painted.normalMap, roughness: 0.82 });
    this.blocks = new THREE.InstancedMesh(new RoundedBoxGeometry(1, 1, 1, 2, 0.08), paint, MAX_BLOCKS);
    this.blocks.castShadow = true;
    this.splinters = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat.bead, MAX_SPLINTERS);
    this.splinters.castShadow = true;

    this.outlines = new THREE.InstancedMesh(
      plane,
      new THREE.MeshBasicMaterial({ map: outlineTexture(), transparent: true, depthWrite: false, depthTest: false }),
      MAX_OUTLINES,
    );
    this.outlines.renderOrder = 8;
    this.trailDots = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.16, 0.16, 0.02, 20),
      new THREE.MeshBasicMaterial({ color: palette.highlight, transparent: true, opacity: 0.9, depthWrite: false, depthTest: false }),
      MAX_OUTLINES,
    );
    this.trailDots.renderOrder = 8;
    for (const mesh of [this.blastTiles, this.blastGlow, this.blocks, this.splinters, this.outlines, this.trailDots]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
    this.blastTiles.setColorAt(0, this.colCore);
    this.blastGlow.setColorAt(0, this.colCore);
    this.blocks.setColorAt(0, this.c.set(0xffffff));

    const starShape = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 0.42 : 0.18;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      if (i === 0) starShape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else starShape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const starGeo = new THREE.ShapeGeometry(starShape);
    starGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < MAX_STARS; i++) {
      const back = new THREE.Mesh(starGeo, new THREE.MeshBasicMaterial({ color: palette.highlight, transparent: true, depthWrite: false, depthTest: false }));
      back.renderOrder = 9;
      const star = new THREE.Mesh(starGeo, new THREE.MeshBasicMaterial({ color: palette.players[0], transparent: true, depthWrite: false, depthTest: false }));
      star.renderOrder = 10;
      back.visible = false;
      star.visible = false;
      this.stars.push(star);
      this.starBacks.push(back);
      this.group.add(back, star);
    }
  }

  setPointScale(scale: number): void {
    this.smoke.setScale(scale);
    this.embers.setScale(scale);
  }

  reset(): void {
    this.chain = null;
    this.lastPuff.clear();
    this.seenExplosions.clear();
    this.smoke.clear();
    this.embers.clear();
    for (const d of this.blockPool) d.alive = false;
    for (const d of this.splinterPool) d.alive = false;
    for (const f of this.flashes) f.power = 0;
  }

  /** Crate destroyed: its painted blocks tumble off, with splinters. */
  crateBurst(tile: Tile, nowSec: number): void {
    const cx = tileWorldX(tile);
    const cz = tileWorldZ(tile);
    for (const b of crateStack(tile)) {
      const d = takeOldest(this.blockPool);
      const a = Math.random() * Math.PI * 2;
      const sp = 1.4 + Math.random() * 2.4;
      d.p.set(cx + b.dx, b.y + 0.05, cz + b.dz);
      d.v.set(Math.cos(a) * sp, 3.2 + Math.random() * 2.8, Math.sin(a) * sp);
      d.r.set(0, b.yaw, 0);
      d.w.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12);
      d.color.set(b.color);
      d.sx = 0.84;
      d.sy = b.h;
      d.sz = 0.84;
      d.born = nowSec;
      d.alive = true;
    }
    this.splinterBurst(cx, cz, 10, nowSec);
    this.dustBurst(cx, cz, 14, 0.3);
  }

  showChain(data: DeathChain, nowSec: number): void {
    const outlines: { tile: Tile; bomb: boolean }[] = [];
    for (const t of data.crossTiles) outlines.push({ tile: t, bomb: data.bombTiles.has(t) });
    for (const t of data.bombTiles) if (!data.crossTiles.has(t)) outlines.push({ tile: t, bomb: true });
    this.chain = { outlines, trail: [...data.trailTiles], stars: data.stars, born: nowSec };
  }

  update(state: GameState, fire: readonly FirePoint[], dt: number, nowSec: number): void {
    this.updateFire(fire, nowSec);
    this.updateBlasts(state, nowSec);
    this.updateFlashes(nowSec);
    this.smoke.update(dt);
    this.embers.update(dt);
    this.updateDebris(this.blocks, this.blockPool, dt, nowSec, true);
    this.updateDebris(this.splinters, this.splinterPool, dt, nowSec, false);
    this.updateChain(nowSec);
  }

  private emit(target: Particles, fill: (s: ParticleSpec) => void): void {
    fill(this.spec);
    target.emit(this.spec);
  }

  private dustBurst(x: number, z: number, n: number, y: number): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.6 + Math.random() * 2.2;
      this.emit(this.smoke, (s) => {
        s.x = x;
        s.y = y;
        s.z = z;
        s.vx = Math.cos(a) * sp;
        s.vy = 1 + Math.random() * 2.5;
        s.vz = Math.sin(a) * sp;
        s.size0 = 0.08;
        s.size1 = 0.14;
        s.life = 0.9 + Math.random() * 0.6;
        s.r = this.dustRgb.r;
        s.g = this.dustRgb.g;
        s.b = this.dustRgb.b;
        s.alpha = 0.9;
        s.gravity = 4;
        s.drag = 1.2;
      });
    }
  }

  private splinterBurst(x: number, z: number, n: number, nowSec: number): void {
    for (let i = 0; i < n; i++) {
      const d = takeOldest(this.splinterPool);
      const a = Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * 3.5;
      d.p.set(x + (Math.random() - 0.5) * 0.4, 0.3 + Math.random() * 0.3, z + (Math.random() - 0.5) * 0.4);
      d.v.set(Math.cos(a) * sp, 2.5 + Math.random() * 3, Math.sin(a) * sp);
      d.r.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      d.w.set((Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20);
      d.color.set(0xffffff);
      d.sx = 0.18 + Math.random() * 0.16;
      d.sy = 0.03;
      d.sz = 0.04;
      d.born = nowSec;
      d.alive = true;
    }
  }

  private explosionBurst(tile: Tile, tiles: readonly Tile[], nowSec: number): void {
    const x = tileWorldX(tile);
    const z = tileWorldZ(tile);
    let flash = this.flashes[0]!;
    for (const f of this.flashes) if (f.born < flash.born) flash = f;
    flash.born = nowSec;
    flash.power = 1;
    flash.light.position.set(x, 0.9, z);
    for (const t of tiles) {
      const tx = tileWorldX(t);
      const tz = tileWorldZ(t);
      for (let i = 0; i < 4; i++) {
        this.emit(this.embers, (s) => {
          s.x = tx + (Math.random() - 0.5) * 0.6;
          s.y = 0.1;
          s.z = tz + (Math.random() - 0.5) * 0.6;
          s.vx = (Math.random() - 0.5) * 1.2;
          s.vy = 1.5 + Math.random() * 2.5;
          s.vz = (Math.random() - 0.5) * 1.2;
          s.size0 = 0.12;
          s.size1 = 0.03;
          s.life = 0.5 + Math.random() * 0.5;
          s.r = this.emberRgb.r * 3;
          s.g = this.emberRgb.g * 2.4;
          s.b = this.emberRgb.b * 1.5;
          s.alpha = 1;
          s.gravity = 2;
          s.drag = 1.5;
        });
      }
      this.emit(this.smoke, (s) => {
        s.x = tx;
        s.y = 0.3;
        s.z = tz;
        s.vx = (Math.random() - 0.5) * 0.4;
        s.vy = 0.6 + Math.random() * 0.4;
        s.vz = (Math.random() - 0.5) * 0.4;
        s.size0 = 0.4;
        s.size1 = 1.3;
        s.life = 1.2 + Math.random() * 0.5;
        s.r = this.smokeRgb.r;
        s.g = this.smokeRgb.g;
        s.b = this.smokeRgb.b;
        s.alpha = 0.45;
        s.gravity = -0.2;
        s.drag = 0.8;
      });
    }
    this.dustBurst(x, z, 18, 0.35);
    this.splinterBurst(x, z, 6, nowSec);
  }

  private updateFire(fire: readonly FirePoint[], nowSec: number): void {
    const n = Math.min(fire.length, MAX_SPARKS);
    for (let i = 0; i < n; i++) {
      const f = fire[i]!;
      const sp = this.sparks[i]!;
      const core = this.sparkCores[i]!;
      const flicker = 0.55 + 0.14 * Math.sin(nowSec * 47 + f.id) + 0.08 * Math.sin(nowSec * 83 + f.id * 3);
      sp.visible = true;
      core.visible = true;
      sp.position.set(f.x, 0.24, f.z);
      sp.scale.set(flicker * 1.6, flicker * 1.6, 1);
      core.position.set(f.x, 0.16, f.z);
      if (i < FIRE_LIGHTS) {
        const l = this.fireLights[i]!;
        l.position.set(f.x, 0.5, f.z);
        l.intensity = 4.5 + 1.2 * Math.sin(nowSec * 37 + f.id) + 0.6 * Math.sin(nowSec * 71);
      }
      const last = this.lastPuff.get(f.id) ?? 0;
      if (nowSec - last > 0.05) {
        this.lastPuff.set(f.id, nowSec);
        this.emit(this.smoke, (s) => {
          s.x = f.x;
          s.y = 0.28;
          s.z = f.z;
          s.vx = (Math.random() - 0.5) * 0.2;
          s.vy = 0.55 + Math.random() * 0.3;
          s.vz = (Math.random() - 0.5) * 0.2;
          s.size0 = 0.1;
          s.size1 = 0.42;
          s.life = 0.9;
          s.r = this.smokeRgb.r;
          s.g = this.smokeRgb.g;
          s.b = this.smokeRgb.b;
          s.alpha = 0.35;
          s.gravity = -0.3;
          s.drag = 0.6;
        });
        this.emit(this.embers, (s) => {
          s.x = f.x;
          s.y = 0.2;
          s.z = f.z;
          s.vx = (Math.random() - 0.5) * 1.4;
          s.vy = 0.8 + Math.random() * 1.2;
          s.vz = (Math.random() - 0.5) * 1.4;
          s.size0 = 0.06;
          s.size1 = 0.02;
          s.life = 0.35;
          s.r = this.emberRgb.r * 3;
          s.g = this.emberRgb.g * 2.2;
          s.b = this.emberRgb.b;
          s.alpha = 1;
          s.gravity = 3;
          s.drag = 1;
        });
      }
    }
    for (let i = n; i < MAX_SPARKS; i++) {
      this.sparks[i]!.visible = false;
      this.sparkCores[i]!.visible = false;
    }
    for (let i = n; i < FIRE_LIGHTS; i++) this.fireLights[i]!.intensity = 0;
    if (this.lastPuff.size > 64) this.lastPuff.clear();
  }

  private updateBlasts(state: GameState, nowSec: number): void {
    let n = 0;
    for (const b of state.blasts) {
      const ex = state.explosions.find((e) => e.id === b.explosionId);
      if (ex && !this.seenExplosions.has(ex.id)) {
        this.seenExplosions.add(ex.id);
        this.explosionBurst(ex.tile, ex.tiles, nowSec);
      }
      const k = Math.max(0, Math.min(1, b.ticksLeft / BLAST_TICKS));
      const centre = ex?.tile ?? -1;
      for (const t of b.tiles) {
        if (n >= MAX_BLAST_TILES) break;
        const x = tileWorldX(t);
        const z = tileWorldZ(t);
        this.c.copy(this.colEdge).lerp(this.colCore, t === centre ? 0.9 : 0.5 * k).lerp(this.colCool, 1 - Math.pow(k, 0.7));
        this.m.compose(this.v.set(x, 0.015, z), this.q.identity(), this.s.set(0.98, 1, 0.98));
        this.blastTiles.setMatrixAt(n, this.m);
        this.blastTiles.setColorAt(n, this.c);
        const h = 0.25 + 0.65 * k;
        const w = 0.55 + 0.45 * k;
        this.m.compose(this.v.set(x, h * 0.35, z), this.q.identity(), this.s.set(w, h, w));
        this.blastGlow.setMatrixAt(n, this.m);
        this.blastGlow.setColorAt(n, this.c.multiplyScalar(0.6 * k));
        n++;
      }
    }
    if (this.seenExplosions.size > 256) this.seenExplosions.clear();
    this.commit(this.blastTiles, n);
    this.commit(this.blastGlow, n);
  }

  private updateFlashes(nowSec: number): void {
    for (const f of this.flashes) {
      const t = (nowSec - f.born) / FLASH_SECONDS;
      f.light.intensity = t >= 0 && t < 1 ? 26 * f.power * (1 - t) * (1 - t) : 0;
    }
  }

  private updateDebris(mesh: THREE.InstancedMesh, pool: Debris[], dt: number, nowSec: number, tinted: boolean): void {
    let n = 0;
    for (const d of pool) {
      if (!d.alive) continue;
      const age = nowSec - d.born;
      if (age >= DEBRIS_SECONDS) {
        d.alive = false;
        continue;
      }
      d.v.y -= 14 * dt;
      d.p.addScaledVector(d.v, dt);
      const half = d.sy / 2;
      // Bounce on the board, fall off the edge onto the bench below.
      const onBoard = Math.abs(d.p.x) < 7.5 && Math.abs(d.p.z) < 6.5;
      const ground = onBoard ? half : -0.55 + half;
      if (d.p.y < ground && d.v.y < 0) {
        d.p.y = ground;
        d.v.y *= -0.3;
        d.v.x *= 0.55;
        d.v.z *= 0.55;
        d.w.multiplyScalar(0.6);
      }
      d.r.x += d.w.x * dt;
      d.r.y += d.w.y * dt;
      d.r.z += d.w.z * dt;
      const fade = Math.min(1, (DEBRIS_SECONDS - age) / 0.35);
      this.m.compose(d.p, this.q.setFromEuler(d.r), this.s.set(d.sx * fade, d.sy * fade, d.sz * fade));
      mesh.setMatrixAt(n, this.m);
      if (tinted) mesh.setColorAt(n, d.color);
      n++;
    }
    this.commit(mesh, n);
  }

  private updateChain(nowSec: number): void {
    const chain = this.chain;
    const t = chain ? nowSec - chain.born : Infinity;
    if (!chain || t > CHAIN_SECONDS) {
      this.chain = null;
      this.outlines.count = 0;
      this.trailDots.count = 0;
      for (let i = 0; i < MAX_STARS; i++) {
        this.stars[i]!.visible = false;
        this.starBacks[i]!.visible = false;
      }
      return;
    }
    const fade = t < CHAIN_SECONDS - 0.3 ? 1 : (CHAIN_SECONDS - t) / 0.3;
    const pulse = 1 + 0.05 * Math.sin(t * 14);
    let n = 0;
    for (const o of chain.outlines) {
      if (n >= MAX_OUTLINES) break;
      const s = o.bomb ? 1.08 * pulse : pulse;
      this.m.compose(this.v.set(tileWorldX(o.tile), 0.06, tileWorldZ(o.tile)), this.q.identity(), this.s.set(s, 1, s));
      this.outlines.setMatrixAt(n++, this.m);
    }
    this.commit(this.outlines, n);
    (this.outlines.material as THREE.MeshBasicMaterial).opacity = fade;

    let d = 0;
    for (const tile of chain.trail) {
      if (d >= MAX_OUTLINES) break;
      this.m.compose(this.v.set(tileWorldX(tile), 0.2, tileWorldZ(tile)), this.q.identity(), this.s.set(pulse, 1, pulse));
      this.trailDots.setMatrixAt(d++, this.m);
    }
    this.commit(this.trailDots, d);
    (this.trailDots.material as THREE.MeshBasicMaterial).opacity = 0.85 * fade;

    for (let i = 0; i < MAX_STARS; i++) {
      const star = this.stars[i]!;
      const back = this.starBacks[i]!;
      const st = chain.stars[i];
      if (!st) {
        star.visible = false;
        back.visible = false;
        continue;
      }
      const pop = Math.min(1, t / 0.15);
      const scale = (0.6 + 0.6 * pop) * (1 + 0.08 * Math.sin(t * 10));
      this.placeStar(star, st.tile, t, fade);
      this.placeStar(back, st.tile, t, fade);
      star.scale.setScalar(scale);
      back.scale.setScalar(scale * 1.3);
      (star.material as THREE.MeshBasicMaterial).color.set(st.by === null ? palette.ash : playerColor(st.by as PlayerId));
    }
  }

  private placeStar(mesh: THREE.Mesh, tile: Tile, t: number, fade: number): void {
    mesh.visible = true;
    mesh.position.set(tileWorldX(tile), 1.1, tileWorldZ(tile));
    mesh.rotation.y = t * 2;
    (mesh.material as THREE.MeshBasicMaterial).opacity = fade;
  }

  private commit(mesh: THREE.InstancedMesh, count: number): void {
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}
