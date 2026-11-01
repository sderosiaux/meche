// The craftsman's workbench the board sits on, with a few out-of-focus props around it (spools of
// the players' yarn, a mug of pencils, a matchbox, an open toy box, shavings, spare blocks).
// Everything stays outside the board's footprint so orbiting never hides the game.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GRID_H, GRID_W } from '../sim/constants';
import { TRAY_BOTTOM } from './board';
import { materials } from './materials';
import { palette } from './palette';

const TOP = TRAY_BOTTOM;

function shadowed<T extends THREE.Object3D>(o: T): T {
  o.traverse((c) => {
    if (c instanceof THREE.Mesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
  return o;
}

function spool(color: THREE.Material, flange: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.7, 32, 1), color);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.08, 32), flange);
  top.position.y = 0.39;
  const bottom = top.clone();
  bottom.position.y = -0.39;
  g.add(wrap, top, bottom);
  return g;
}

function mugWithPencils(mat: ReturnType<typeof materials>): THREE.Group {
  const g = new THREE.Group();
  const pts: THREE.Vector2[] = [];
  for (const [r, y] of [
    [0, 0],
    [0.5, 0],
    [0.54, 0.05],
    [0.56, 1.1],
    [0.5, 1.1],
    [0.48, 0.1],
    [0, 0.1],
  ] as const)
    pts.push(new THREE.Vector2(r, y));
  const ceramic = new THREE.MeshPhysicalMaterial({ color: palette.hudSurface, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1 });
  const mug = new THREE.Mesh(new THREE.LatheGeometry(pts, 40), ceramic);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.07, 12, 24, Math.PI * 1.2), ceramic);
  handle.position.set(0.6, 0.6, 0);
  handle.rotation.z = -Math.PI * 0.6;
  g.add(mug, handle);
  const colors = [palette.players[2], palette.players[0], palette.players[1], palette.players[3], palette.paints[4]];
  colors.forEach((c, i) => {
    const pencil = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.6, 6), new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 }));
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 6), mat.hatWood);
    tip.position.y = 0.91;
    pencil.add(body, tip);
    const a = (i / colors.length) * Math.PI * 2;
    pencil.position.set(Math.cos(a) * 0.22, 1.2, Math.sin(a) * 0.22);
    pencil.rotation.set(Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25);
    g.add(pencil);
  });
  return g;
}

function matchbox(mat: ReturnType<typeof materials>): THREE.Group {
  const g = new THREE.Group();
  const sleeve = new THREE.Mesh(new RoundedBoxGeometry(1.1, 0.32, 0.75, 2, 0.03), new THREE.MeshStandardMaterial({ color: palette.players[0], roughness: 0.7 }));
  const drawer = new THREE.Mesh(new RoundedBoxGeometry(1.0, 0.26, 0.68, 2, 0.02), mat.hatWood);
  drawer.position.set(0.45, -0.02, 0);
  g.add(drawer, sleeve);
  const head = new THREE.MeshStandardMaterial({ color: palette.players[0], roughness: 0.6 });
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Group();
    const stick = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.05), mat.hatWood);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), head);
    tip.position.x = 0.47;
    m.add(stick, tip);
    m.position.set(-0.3 + i * 0.25, -0.13, 0.75 + i * 0.12);
    m.rotation.y = 0.4 - i * 0.3;
    g.add(m);
  }
  return g;
}

function toyBox(mat: ReturnType<typeof materials>): THREE.Group {
  const g = new THREE.Group();
  const w = 3.2;
  const d = 2.4;
  const h = 1.4;
  const t = 0.12;
  const wall = (sx: number, sz: number, x: number, z: number) => {
    const m = new THREE.Mesh(new RoundedBoxGeometry(sx, h, sz, 2, 0.04), mat.hatWood);
    m.position.set(x, h / 2, z);
    g.add(m);
  };
  wall(w, t, 0, -d / 2);
  wall(w, t, 0, d / 2);
  wall(t, d, -w / 2, 0);
  wall(t, d, w / 2, 0);
  const bottom = new THREE.Mesh(new THREE.BoxGeometry(w, t, d), mat.hatWood);
  bottom.position.y = t / 2;
  g.add(bottom);
  const lid = new THREE.Mesh(new RoundedBoxGeometry(w + 0.1, t, d + 0.1, 2, 0.04), mat.hatWood);
  lid.position.set(0, h + d / 2 - 0.1, -d / 2 - 0.15);
  lid.rotation.x = -Math.PI / 2 + 0.25;
  g.add(lid);
  const block = new RoundedBoxGeometry(0.6, 0.6, 0.6, 2, 0.06);
  palette.paints.slice(0, 5).forEach((c, i) => {
    const b = new THREE.Mesh(block, new THREE.MeshStandardMaterial({ color: c, map: mat.painted.map, roughness: 0.8 }));
    b.position.set(-1 + (i % 3) * 0.75, 0.45 + Math.floor(i / 3) * 0.55, -0.4 + (i % 2) * 0.6);
    b.rotation.set(0.1 * i, 0.5 * i, 0.07 * i);
    g.add(b);
  });
  return g;
}

function shavings(mat: ReturnType<typeof materials>, seed: number): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const r = 0.18 + ((Math.sin(seed + i * 3.1) + 1) / 2) * 0.16;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.05, 6, 18, Math.PI * (1.2 + (i % 3) * 0.3)), mat.bead);
    ring.position.set(Math.sin(seed * 7 + i) * 1.1, 0.08, Math.cos(seed * 5 + i * 1.7) * 0.8);
    ring.rotation.set(Math.PI / 2 + Math.sin(i) * 0.6, i * 0.9, Math.cos(i) * 0.5);
    ring.scale.set(1, 1, 0.35);
    g.add(ring);
  }
  return g;
}

export function buildWorkbench(): THREE.Group {
  const mat = materials();
  const g = new THREE.Group();
  const table = new THREE.Mesh(new THREE.BoxGeometry(52, 1.2, 36), mat.bench);
  table.position.y = TOP - 0.6;
  table.receiveShadow = true;
  g.add(table);

  const hw = GRID_W / 2;
  const hd = GRID_H / 2;
  const flange = mat.hatWood;
  [0, 1, 3].forEach((p, i) => {
    const s = spool(mat.yarn[p]!, flange);
    s.position.set(-hw - 2.6 - (i % 2) * 1.2, TOP + 0.43, -hd + 1.2 + i * 1.25);
    g.add(s);
  });
  const lying = spool(mat.yarn[2]!, flange);
  lying.rotation.z = Math.PI / 2;
  lying.rotation.y = 0.6;
  lying.position.set(-hw - 2.2, TOP + 0.5, hd - 1.6);
  g.add(lying);

  const mug = mugWithPencils(mat);
  mug.position.set(hw + 2.6, TOP, -hd + 1.4);
  g.add(mug);

  const box = matchbox(mat);
  box.position.set(hw + 2.4, TOP + 0.16, hd - 1.5);
  box.rotation.y = -0.5;
  g.add(box);

  const tb = toyBox(mat);
  tb.position.set(-hw - 2.2, TOP, -hd - 4.2);
  tb.rotation.y = 0.18;
  g.add(tb);

  const sh1 = shavings(mat, 1);
  sh1.position.set(hw + 2.2, TOP, 1.2);
  const sh2 = shavings(mat, 2);
  sh2.position.set(-2.5, TOP, hd + 1.9);
  const sh3 = shavings(mat, 3);
  sh3.position.set(3.5, TOP, -hd - 1.8);
  g.add(sh1, sh2, sh3);

  const spare = new RoundedBoxGeometry(0.62, 0.62, 0.62, 2, 0.06);
  [
    [hw + 1.6, hd + 1.3, 4, 0.5],
    [hw + 2.5, hd + 0.4, 1, 1.2],
    [-hw - 1.7, hd + 2.2, 0, 0.3],
    [4.5, hd + 2.6, 2, 0.9],
  ].forEach(([x, z, c, yaw]) => {
    const b = new THREE.Mesh(spare, new THREE.MeshStandardMaterial({ color: palette.paints[c!]!, map: mat.painted.map, roughness: 0.8 }));
    b.position.set(x!, TOP + 0.31, z!);
    b.rotation.y = yaw!;
    g.add(b);
  });
  return shadowed(g);
}
