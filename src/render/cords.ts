// Cords as round cotton yarn lying on the board: instanced tube segments per player (each player
// has its own yarn pattern, spec §17), a sphere at every bend for round corners, wooden beads on
// knot tiles, and a thin grey ash trace left behind each moving flame. Instancing keeps GPU buffers
// fixed while cords change every tick.
import * as THREE from 'three';
import type { GameState, PlayerId } from '../sim/types';
import { tileWorldX, tileWorldZ } from './coords';
import { cordPieces, firePoints, knotTiles, type FirePoint } from './cordShapes';
import { materials } from './materials';
import { palette } from './palette';

const MAX_SEGMENTS = 256; // per player
const MAX_ASH = 1024;
const MAX_KNOTS = 64;
export const CORD_RADIUS = 0.085;
const CORD_Y = CORD_RADIUS + 0.004;
const KNOT_R = 0.12;
const KNOT_Y = CORD_Y + CORD_RADIUS + KNOT_R * 0.45;
const ASH_SECONDS = 1;
/** World length covered by one repeat of the yarn texture. */
const YARN_REPEAT = 0.9;

interface AshPiece {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  born: number;
}

/** Tube along +Y with its UVs swapped (u along the length, v around) and a per-instance UV span. */
function yarnSegmentGeometry(radius: number): THREE.CylinderGeometry {
  const g = new THREE.CylinderGeometry(radius, radius, 1, 14, 1, true);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i);
    uv.setXY(i, 1 - uv.getY(i), u);
  }
  g.setAttribute('yarnUv', new THREE.InstancedBufferAttribute(new Float32Array(MAX_SEGMENTS * 2), 2));
  return g;
}

/** Yarn material variant that maps u through the per-instance (start, length) span. */
function yarnSegmentMaterial(base: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const m = base.clone();
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 yarnUv;')
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
        float yarnU = (yarnUv.x + uv.x * yarnUv.y) / ${YARN_REPEAT.toFixed(3)};
        #ifdef USE_MAP
          vMapUv = vec2(yarnU, uv.y);
        #endif
        #ifdef USE_BUMPMAP
          vBumpMapUv = vec2(yarnU, uv.y);
        #endif`,
      );
  };
  m.customProgramCacheKey = () => 'yarnSegment';
  return m;
}

interface PlayerYarn {
  readonly segments: THREE.InstancedMesh;
  readonly span: THREE.InstancedBufferAttribute;
  readonly joints: THREE.InstancedMesh;
  ns: number;
  nj: number;
  /** Running length along the current cord, so the twist stays continuous across segments. */
  run: number;
  lastCord: number;
}

export class Cords {
  readonly group = new THREE.Group();
  private readonly yarns: PlayerYarn[];
  private readonly ash: THREE.InstancedMesh;
  private readonly knots: THREE.InstancedMesh;
  private readonly ashColor = new THREE.Color(palette.ash);
  private readonly floorColor = new THREE.Color(palette.maple);
  private ashPieces: AshPiece[] = [];
  private readonly tmp = new THREE.Color();
  private lastFire = new Map<number, FirePoint>();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly d = new THREE.Vector3();
  private readonly yAxis = new THREE.Vector3(0, 1, 0);

  constructor() {
    const mat = materials();
    const jointGeo = new THREE.SphereGeometry(CORD_RADIUS, 14, 10);
    this.yarns = mat.yarn.map((base) => {
      const geo = yarnSegmentGeometry(CORD_RADIUS);
      const segments = new THREE.InstancedMesh(geo, yarnSegmentMaterial(base), MAX_SEGMENTS);
      const joints = new THREE.InstancedMesh(jointGeo, base, MAX_SEGMENTS * 2);
      for (const mesh of [segments, joints]) {
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.group.add(mesh);
      }
      return { segments, joints, span: geo.getAttribute('yarnUv') as THREE.InstancedBufferAttribute, ns: 0, nj: 0, run: 0, lastCord: -1 };
    });
    this.ash = new THREE.InstancedMesh(new THREE.CylinderGeometry(CORD_RADIUS * 0.55, CORD_RADIUS * 0.55, 1, 8, 1, true), mat.ash, MAX_ASH);
    this.ash.setColorAt(0, this.ashColor);
    this.knots = new THREE.InstancedMesh(new THREE.SphereGeometry(KNOT_R, 20, 14), mat.bead, MAX_KNOTS);
    for (const mesh of [this.ash, this.knots]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = mesh === this.knots;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  reset(): void {
    this.ashPieces = [];
    this.lastFire.clear();
  }

  update(state: GameState, prev: GameState | null, alpha: number, hands: ReadonlyMap<PlayerId, { x: number; z: number }>, nowSec: number): FirePoint[] {
    for (const y of this.yarns) {
      y.ns = 0;
      y.nj = 0;
      y.run = 0;
      y.lastCord = -1;
    }
    for (const p of cordPieces(state, prev, alpha, hands)) {
      const y = this.yarns[p.owner];
      if (!y || y.ns >= MAX_SEGMENTS || y.nj + 2 > MAX_SEGMENTS * 2) continue;
      if (p.cordId !== y.lastCord) {
        y.lastCord = p.cordId;
        y.run = 0;
      }
      const len = Math.hypot(p.bx - p.ax, p.bz - p.az);
      if (this.placeTube(y.segments, y.ns, p.ax, p.az, p.bx, p.bz, CORD_Y, 1)) {
        y.span.setXY(y.ns, y.run, len);
        y.ns++;
      }
      y.run += len;
      for (const [x, z] of [
        [p.ax, p.az],
        [p.bx, p.bz],
      ] as const) {
        this.m.makeTranslation(x, CORD_Y, z);
        y.joints.setMatrixAt(y.nj++, this.m);
      }
    }
    for (const y of this.yarns) {
      this.commit(y.segments, y.ns);
      y.span.needsUpdate = true;
      this.commit(y.joints, y.nj);
    }

    const fire = firePoints(state, prev, alpha);
    this.trackAsh(fire, state, nowSec);
    let na = 0;
    for (const a of this.ashPieces) {
      if (na >= MAX_ASH) break;
      const age = (nowSec - a.born) / ASH_SECONDS;
      if (this.placeTube(this.ash, na, a.ax, a.az, a.bx, a.bz, CORD_RADIUS * 0.4, 1)) {
        this.ash.setColorAt(na, this.tmp.copy(this.ashColor).lerp(this.floorColor, Math.min(1, age * age)));
        na++;
      }
    }
    this.commit(this.ash, na);

    let nk = 0;
    for (const tile of knotTiles(state)) {
      if (nk >= MAX_KNOTS) break;
      this.m.makeTranslation(tileWorldX(tile), KNOT_Y, tileWorldZ(tile));
      this.knots.setMatrixAt(nk++, this.m);
    }
    this.commit(this.knots, nk);
    return fire;
  }

  /** Lays the consumed stretch of each moving flame down as ash. */
  private trackAsh(fire: readonly FirePoint[], state: GameState, nowSec: number): void {
    let keep = 0;
    for (const a of this.ashPieces) if (nowSec - a.born < ASH_SECONDS) this.ashPieces[keep++] = a;
    this.ashPieces.length = keep;
    const next = new Map<number, FirePoint>();
    for (const f of fire) {
      const before = this.lastFire.get(f.id);
      if (before) {
        if (Math.hypot(f.x - before.x, f.z - before.z) > 0.002) {
          this.ashPieces.push({ ax: before.x, az: before.z, bx: f.x, bz: f.z, born: nowSec });
        }
      } else {
        const front = state.fronts.find((x) => x.id === f.id);
        const cord = front && state.cords.find((c) => c.id === front.cordId);
        const from = cord && front ? cord.nodes[front.from] : undefined;
        if (from) this.ashPieces.push({ ax: tileWorldX(from.tile), az: tileWorldZ(from.tile), bx: f.x, bz: f.z, born: nowSec });
      }
      next.set(f.id, f);
    }
    this.lastFire = next;
  }

  /** Orients a unit +Y tube from a to b, lying at height y. */
  private placeTube(mesh: THREE.InstancedMesh, i: number, ax: number, az: number, bx: number, bz: number, y: number, thickness: number): boolean {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-4) return false;
    this.d.set((bx - ax) / len, 0, (bz - az) / len);
    this.q.setFromUnitVectors(this.yAxis, this.d);
    this.m.compose(this.v.set((ax + bx) / 2, y, (az + bz) / 2), this.q, this.s.set(thickness, len, thickness));
    mesh.setMatrixAt(i, this.m);
    return true;
  }

  private commit(mesh: THREE.InstancedMesh, count: number): void {
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}
