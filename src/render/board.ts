// Static board: a walnut tray with a raised rim, pale maple floor tiles, walnut pillars and crates
// made of stacked pastel-painted blocks. Rebuilt on a new round and when crates are destroyed
// (never per frame). Variation is seeded by tile index, so a board always looks the same.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GRID_H, GRID_W } from '../sim/constants';
import type { Cell, Tile } from '../sim/types';
import { woodTexture } from './assets';
import { materials } from './materials';
import { palette } from './palette';

const CAPACITY = GRID_W * GRID_H;

export const FRAME_HEIGHT = 0.62;
export const PILLAR_HEIGHT = 0.8;
export const CRATE_HEIGHT = 0.64;
export const FLOOR_Y = 0;
/** Bottom of the tray: the workbench surface sits here. */
export const TRAY_BOTTOM = -0.55;

/** Deterministic per-tile noise in [0, 1). */
export function tileHash(tile: number, salt: number): number {
  const x = Math.sin(tile * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export interface CrateBlock {
  readonly y: number;
  readonly h: number;
  readonly color: string;
  readonly yaw: number;
  readonly dx: number;
  readonly dz: number;
}

/** The painted blocks a crate on `tile` is made of, bottom to top (shared with the debris). */
export function crateStack(tile: Tile): CrateBlock[] {
  const count = tileHash(tile, 1) < 0.45 ? 3 : 2;
  const h = CRATE_HEIGHT / count;
  const out: CrateBlock[] = [];
  let last = -1;
  for (let i = 0; i < count; i++) {
    let c = Math.floor(tileHash(tile, 10 + i) * palette.paints.length);
    if (c === last) c = (c + 1) % palette.paints.length;
    last = c;
    out.push({
      y: h * i + h / 2,
      h,
      color: palette.paints[c]!,
      yaw: (tileHash(tile, 20 + i) - 0.5) * 0.18,
      dx: (tileHash(tile, 30 + i) - 0.5) * 0.05,
      dz: (tileHash(tile, 40 + i) - 0.5) * 0.05,
    });
  }
  return out;
}

function uvOffsets(geometry: THREE.BufferGeometry, count: number): THREE.InstancedBufferAttribute {
  const attr = new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2);
  geometry.setAttribute('uvOffset', attr);
  return attr;
}

export class Board {
  readonly group = new THREE.Group();
  private readonly floor: THREE.InstancedMesh;
  private readonly floorUv: THREE.InstancedBufferAttribute;
  private readonly pillars: THREE.InstancedMesh;
  private readonly pillarUv: THREE.InstancedBufferAttribute;
  private readonly crates2: THREE.InstancedMesh;
  private readonly crates2Uv: THREE.InstancedBufferAttribute;
  private readonly crates3: THREE.InstancedMesh;
  private readonly crates3Uv: THREE.InstancedBufferAttribute;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3(1, 1, 1);
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly c = new THREE.Color();
  private readonly mapleA = new THREE.Color(palette.maple);
  private readonly mapleB = new THREE.Color(palette.mapleAlt);
  private readonly white = new THREE.Color(0xffffff);

  constructor() {
    const mat = materials();

    // Tray under the tiles and raised rim over the frame cells.
    const trayH = -TRAY_BOTTOM + 0.02;
    const tray = new THREE.Mesh(new RoundedBoxGeometry(GRID_W + 0.3, trayH, GRID_H + 0.3, 4, 0.14), mat.walnutFrame);
    tray.position.y = TRAY_BOTTOM + trayH / 2 - 0.04;
    tray.castShadow = true;
    tray.receiveShadow = true;
    this.group.add(tray);

    // Bars along x: same walnut, grain turned to run along the bar.
    const along = mat.walnutFrame.clone();
    along.map = woodTexture('walnut', 'color', { repeat: [0.35, 4], rotation: Math.PI / 2 });
    along.normalMap = woodTexture('walnut', 'normal', { repeat: [0.35, 4], rotation: Math.PI / 2 });
    const rimH = FRAME_HEIGHT + 0.05;
    const rimY = rimH / 2 - 0.05;
    const longBar = new RoundedBoxGeometry(GRID_W + 0.3, rimH, 1.15, 4, 0.16);
    const sideBar = new RoundedBoxGeometry(1.15, rimH, GRID_H + 0.3, 4, 0.16);
    for (const z of [-GRID_H / 2 + 0.5 - 0.075, GRID_H / 2 - 0.5 + 0.075]) {
      const bar = new THREE.Mesh(longBar, along);
      bar.position.set(0, rimY, z);
      this.group.add(bar);
    }
    for (const x of [-GRID_W / 2 + 0.5 - 0.075, GRID_W / 2 - 0.5 + 0.075]) {
      const bar = new THREE.Mesh(sideBar, mat.walnutFrame);
      bar.position.set(x, rimY, 0);
      this.group.add(bar);
    }
    this.group.children.forEach((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });

    const floorGeo = new RoundedBoxGeometry(0.978, 0.1, 0.978, 2, 0.02);
    this.floorUv = uvOffsets(floorGeo, CAPACITY);
    this.floor = new THREE.InstancedMesh(floorGeo, mat.maple, CAPACITY);
    this.floor.receiveShadow = true;

    const pillarGeo = new RoundedBoxGeometry(0.86, PILLAR_HEIGHT, 0.86, 4, 0.11);
    this.pillarUv = uvOffsets(pillarGeo, CAPACITY);
    this.pillars = new THREE.InstancedMesh(pillarGeo, mat.walnut, CAPACITY);

    const c2 = new RoundedBoxGeometry(0.84, CRATE_HEIGHT / 2 - 0.006, 0.84, 3, 0.06);
    this.crates2Uv = uvOffsets(c2, CAPACITY * 2);
    this.crates2 = new THREE.InstancedMesh(c2, mat.painted, CAPACITY * 2);
    const c3 = new RoundedBoxGeometry(0.84, CRATE_HEIGHT / 3 - 0.006, 0.84, 3, 0.05);
    this.crates3Uv = uvOffsets(c3, CAPACITY * 3);
    this.crates3 = new THREE.InstancedMesh(c3, mat.painted, CAPACITY * 3);

    for (const m of [this.pillars, this.crates2, this.crates3]) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
    for (const m of [this.floor, this.pillars, this.crates2, this.crates3]) {
      m.setColorAt(0, this.white);
      m.count = 0;
    }
    this.group.add(this.floor, this.pillars, this.crates2, this.crates3);
  }

  rebuild(cells: readonly Cell[]): void {
    let nf = 0;
    let np = 0;
    let n2 = 0;
    let n3 = 0;
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      if (cell === 'frame') continue;
      const cx = (i % GRID_W) + 0.5 - GRID_W / 2;
      const cz = Math.floor(i / GRID_W) + 0.5 - GRID_H / 2;
      if (cell === 'pillar') {
        this.q.setFromAxisAngle(this.up, tileHash(i, 3) < 0.5 ? 0 : Math.PI / 2);
        this.m.compose(this.p.set(cx, PILLAR_HEIGHT / 2, cz), this.q, this.s);
        this.pillars.setMatrixAt(np, this.m);
        this.pillars.setColorAt(np, this.c.setScalar(0.92 + tileHash(i, 4) * 0.12));
        this.pillarUv.setXY(np, tileHash(i, 5), tileHash(i, 6));
        np++;
        continue;
      }
      this.q.setFromAxisAngle(this.up, tileHash(i, 7) < 0.5 ? 0 : Math.PI);
      this.m.compose(this.p.set(cx, FLOOR_Y - 0.05, cz), this.q, this.s);
      this.floor.setMatrixAt(nf, this.m);
      this.floor.setColorAt(nf, this.c.copy(this.mapleA).lerp(this.mapleB, tileHash(i, 8) * 0.85));
      this.floorUv.setXY(nf, tileHash(i, 9), tileHash(i, 2));
      nf++;
      if (cell === 'crate') {
        const stack = crateStack(i);
        const mesh = stack.length === 3 ? this.crates3 : this.crates2;
        const uv = stack.length === 3 ? this.crates3Uv : this.crates2Uv;
        for (const [k, b] of stack.entries()) {
          const n = stack.length === 3 ? n3++ : n2++;
          this.q.setFromAxisAngle(this.up, b.yaw);
          this.m.compose(this.p.set(cx + b.dx, b.y, cz + b.dz), this.q, this.s);
          mesh.setMatrixAt(n, this.m);
          mesh.setColorAt(n, this.c.set(b.color));
          uv.setXY(n, tileHash(i, 50 + k), tileHash(i, 60 + k));
        }
      }
    }
    const commit = (mesh: THREE.InstancedMesh, uv: THREE.InstancedBufferAttribute, count: number) => {
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      uv.needsUpdate = true;
      mesh.computeBoundingSphere();
    };
    commit(this.floor, this.floorUv, nf);
    commit(this.pillars, this.pillarUv, np);
    commit(this.crates2, this.crates2Uv, n2);
    commit(this.crates3, this.crates3Uv, n3);
  }
}
