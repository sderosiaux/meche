// Peg dolls and bombs. Positions are interpolated between the previous and current sim state.
// Dolls are lathe-turned lacquered wood with a painted face and a wooden hat whose shape identifies
// the player even without colour (spec §17). Bombs are polished dark wooden balls banded in the
// owner's colour.
import * as THREE from 'three';
import { BOMB_TILE_TICKS, CORD_WARN } from '../sim/constants';
import type { Bomb, Dir, GameState, Player, PlayerId } from '../sim/types';
import { actionGlyphTexture, faceTexture } from './assets';
import { tileWorldX, tileWorldZ, worldX, worldZ } from './coords';
import { materials } from './materials';
import { hats, palette, type HatKind } from './palette';

const YAW: Record<Dir, number> = { down: 0, right: Math.PI / 2, up: Math.PI, left: -Math.PI / 2 };
const HINT_AFTER_TICKS = 180; // 3 s holding without growth (spec §13)
/** Dolls are chunky toys: a little taller than half a tile, as wide as a bomb. */
const DOLL_SCALE = 1.28;
const HEAD_Y = 0.6;
const HEAD_R = 0.15;
const BOMB_R = 0.29;

function bodyGeometry(): THREE.LatheGeometry {
  const profile: [number, number][] = [
    [0, 0],
    [0.19, 0],
    [0.215, 0.015],
    [0.225, 0.05],
    [0.222, 0.1],
    [0.212, 0.17],
    [0.195, 0.25],
    [0.17, 0.33],
    [0.14, 0.4],
    [0.115, 0.44],
    [0.09, 0.47],
    [0.085, 0.5],
  ];
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    40,
  );
}

function hatMesh(kind: HatKind, material: THREE.Material): THREE.Object3D {
  const top = HEAD_Y + HEAD_R * 0.86;
  switch (kind) {
    case 'cone': {
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.115, 0.26, 28), material);
      m.position.y = top + 0.1;
      return m;
    }
    case 'cap': {
      const g = new THREE.Group();
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.135, 0.07, 28), material);
      crown.position.y = top + 0.015;
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.022, 32), material);
      brim.position.set(0, top - 0.02, 0.04);
      g.add(crown, brim);
      return g;
    }
    case 'knob': {
      const g = new THREE.Group();
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.06, 12), material);
      stem.position.y = top + 0.02;
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.07, 20, 14), material);
      ball.position.y = top + 0.09;
      g.add(stem, ball);
      return g;
    }
    case 'ring': {
      const m = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.025, 12, 36), material);
      m.rotation.x = Math.PI / 2 - 0.25;
      m.position.y = top + 0.1;
      return m;
    }
  }
}

interface DollView {
  readonly root: THREE.Group;
  readonly body: THREE.Group;
  readonly hand: THREE.Mesh;
  readonly handMaterial: THREE.MeshStandardMaterial;
  readonly hint: THREE.Sprite;
  readonly hintRing: THREE.Mesh;
  hopPhase: number;
  lastX: number;
  lastZ: number;
  deathStart: number | null;
  deathDir: THREE.Vector2;
  deathFrom: THREE.Vector3;
}

interface BombView {
  readonly root: THREE.Group;
}

export class Actors {
  readonly group = new THREE.Group();
  private readonly dolls = new Map<PlayerId, DollView>();
  private readonly bombViews = new Map<number, BombView>();
  private readonly bombPool: BombView[][] = [[], [], [], []];
  private readonly bombGeometry = new THREE.SphereGeometry(BOMB_R, 32, 22);
  private readonly bandGeometry = new THREE.TorusGeometry(BOMB_R * 0.98, 0.035, 12, 40);
  private readonly stubGeometry = new THREE.CylinderGeometry(0.045, 0.055, 0.08, 14);
  private readonly glyph = actionGlyphTexture();
  private readonly face = faceTexture();

  /** World positions of the dolls this frame, used to attach held cords to the hand. */
  readonly hands = new Map<PlayerId, { x: number; z: number }>();
  private readonly handPoints: { x: number; z: number }[] = [0, 1, 2, 3].map(() => ({ x: 0, z: 0 }));

  constructor() {
    // The four dolls are built once and reused every round: nothing to dispose between rounds.
    for (const id of [0, 1, 2, 3] as const) this.dolls.set(id, this.makeDoll(id));
  }

  reset(state: GameState): void {
    for (const [id, v] of this.bombViews) this.releaseBomb(id, v);
    for (const [id, v] of this.dolls) {
      const p = state.players[id];
      v.root.visible = p !== null && p !== undefined;
      v.deathStart = null;
      v.hopPhase = 0;
      v.body.rotation.set(0, 0, 0);
      v.body.scale.setScalar(DOLL_SCALE);
      if (p) {
        v.lastX = worldX(p.x);
        v.lastZ = worldZ(p.y);
      }
    }
  }

  /** Called on 'player-died' to start the knock-over flight away from the blast. */
  startDeath(player: PlayerId, fromTile: number, nowSec: number): void {
    const v = this.dolls.get(player);
    if (!v) return;
    v.deathStart = nowSec;
    v.deathFrom.copy(v.root.position);
    const dx = v.root.position.x - tileWorldX(fromTile);
    const dz = v.root.position.z - tileWorldZ(fromTile);
    const len = Math.hypot(dx, dz);
    v.deathDir.set(len > 0.01 ? dx / len : 0, len > 0.01 ? dz / len : 1);
  }

  update(state: GameState, prev: GameState | null, alpha: number, nowSec: number): void {
    this.hands.clear();
    for (const [id, v] of this.dolls) {
      const p = state.players[id];
      if (!p) {
        v.root.visible = false;
        continue;
      }
      this.updateDoll(v, p, prev?.players[id] ?? null, alpha, state, nowSec);
    }
    this.updateBombs(state.bombs, state.tick, nowSec);
  }

  private makeDoll(id: PlayerId): DollView {
    const mat = materials();
    const lacquer = mat.lacquer[id]!;
    const root = new THREE.Group();
    const body = new THREE.Group();
    const torso = new THREE.Mesh(bodyGeometry(), lacquer);
    const head = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R, 32, 24), lacquer);
    head.position.y = HEAD_Y;
    // Face decal: a slightly larger front cap of the head sphere carrying the painted face.
    const faceMat = new THREE.MeshStandardMaterial({ map: this.face, transparent: true, roughness: 0.4, depthWrite: false });
    const face = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R * 1.006, 32, 24, Math.PI * 0.25, Math.PI * 0.5, Math.PI * 0.25, Math.PI * 0.5), faceMat);
    face.position.y = HEAD_Y; // phi centred on π/2: the cap faces +z, the doll's front
    face.renderOrder = 1;
    const hat = hatMesh(hats[id] ?? 'cone', mat.hatWood);
    body.add(torso, head, face, hat);
    body.traverse((o) => {
      if (o instanceof THREE.Mesh && o !== face) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });

    const handMaterial = mat.yarn[id]!.clone();
    handMaterial.emissive = new THREE.Color(palette.highlight);
    handMaterial.emissiveIntensity = 0;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.1, 18, 12), handMaterial);
    hand.position.set(0.21, 0.28, 0.08);
    hand.castShadow = true;
    hand.visible = false;
    body.add(hand);

    const hint = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glyph, depthTest: false, transparent: true }));
    hint.scale.set(0.5, 0.5, 1);
    hint.position.set(0, 1.3, 0);
    hint.visible = false;
    hint.renderOrder = 10;
    const hintRing = new THREE.Mesh(
      new THREE.RingGeometry(0.38, 0.45, 48),
      new THREE.MeshBasicMaterial({ color: palette.players[id], transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }),
    );
    hintRing.rotation.x = -Math.PI / 2;
    hintRing.position.y = 0.03;
    hintRing.visible = false;

    root.add(body, hint, hintRing);
    this.group.add(root);
    return {
      root,
      body,
      hand,
      handMaterial,
      hint,
      hintRing,
      hopPhase: 0,
      lastX: 0,
      lastZ: 0,
      deathStart: null,
      deathDir: new THREE.Vector2(0, 1),
      deathFrom: new THREE.Vector3(),
    };
  }

  private updateDoll(v: DollView, p: Player, before: Player | null, alpha: number, state: GameState, nowSec: number): void {
    if (!p.alive) {
      v.hint.visible = false;
      v.hintRing.visible = false;
      v.hand.visible = false;
      if (v.deathStart === null) {
        v.root.visible = false;
        return;
      }
      const t = nowSec - v.deathStart;
      if (t > 1.4) {
        v.root.visible = false;
        return;
      }
      v.root.visible = true;
      v.root.position.set(v.deathFrom.x + v.deathDir.x * t * 3.4, v.deathFrom.y + 3.6 * t - 4.8 * t * t, v.deathFrom.z + v.deathDir.y * t * 3.4);
      v.body.rotation.x = t * 9 * (v.deathDir.y >= 0 ? 1 : -1);
      v.body.rotation.z = t * 7 * (v.deathDir.x >= 0 ? -1 : 1);
      v.body.scale.setScalar(DOLL_SCALE);
      return;
    }

    v.deathStart = null;
    v.root.visible = true;
    v.body.rotation.set(0, 0, 0);
    const bx = before && before.alive ? before.x : p.x;
    const by = before && before.alive ? before.y : p.y;
    const x = worldX(bx + (p.x - bx) * alpha);
    const z = worldZ(by + (p.y - by) * alpha);
    const travelled = Math.hypot(x - v.lastX, z - v.lastZ);
    v.lastX = x;
    v.lastZ = z;
    if (p.moving && travelled < 0.5) v.hopPhase += travelled * Math.PI * 2;
    else if (!p.moving) v.hopPhase = 0;
    const s = Math.sin(v.hopPhase);
    const hop = p.moving ? Math.abs(s) * 0.11 : 0;
    // Squash on contact, stretch in the air.
    const stretch = p.moving ? 1 + 0.07 * (Math.abs(s) * 2 - 1) : 1 + 0.015 * Math.sin(nowSec * 2.4 + p.id);
    v.body.scale.set(DOLL_SCALE / Math.sqrt(stretch), DOLL_SCALE * stretch, DOLL_SCALE / Math.sqrt(stretch));
    v.root.position.set(x, hop, z);
    v.body.rotation.y = YAW[p.facing];
    const hand = this.handPoints[p.id]!;
    hand.x = x;
    hand.z = z;
    this.hands.set(p.id, hand);

    const cord = p.heldCord === null ? undefined : state.cords.find((c) => c.id === p.heldCord);
    v.hand.visible = cord !== undefined;
    if (cord) {
      const length = cord.nodes.length - 1;
      const warn = length >= p.cordMax - CORD_WARN;
      v.handMaterial.emissiveIntensity = warn ? (Math.sin(nowSec * Math.PI * 12) > 0 ? 0.7 : 0) : 0;
    }
    const idle = cord !== undefined && p.heldSince !== null && state.tick - p.heldSince >= HINT_AFTER_TICKS;
    v.hint.visible = idle;
    v.hintRing.visible = idle;
    if (idle) {
      const pulse = 1 + 0.12 * Math.sin(nowSec * 6);
      v.hintRing.scale.set(pulse, pulse, pulse);
      v.hint.position.y = 1.3 + 0.05 * Math.sin(nowSec * 4);
    }
  }

  private makeBomb(owner: PlayerId): BombView {
    const mat = materials();
    const root = new THREE.Group();
    const ball = new THREE.Mesh(this.bombGeometry, mat.bomb);
    const band = new THREE.Mesh(this.bandGeometry, mat.lacquer[owner]!);
    band.rotation.x = Math.PI / 2;
    const stub = new THREE.Mesh(this.stubGeometry, mat.hatWood);
    stub.position.y = BOMB_R + 0.02;
    for (const m of [ball, band, stub]) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
    root.add(ball, band, stub);
    return { root };
  }

  private releaseBomb(id: number, v: BombView): void {
    this.group.remove(v.root);
    this.bombViews.delete(id);
    const owner = (v.root.userData.owner ?? 0) as PlayerId;
    this.bombPool[owner]!.push(v);
  }

  private updateBombs(bombs: readonly Bomb[], tick: number, nowSec: number): void {
    for (const b of bombs) {
      let view = this.bombViews.get(b.id);
      if (!view) {
        view = this.bombPool[b.owner]!.pop() ?? this.makeBomb(b.owner);
        view.root.userData.owner = b.owner;
        view.root.userData.seen = 0;
        this.group.add(view.root);
        this.bombViews.set(b.id, view);
      }
      view.root.userData.seen = tick;
      const age = tick - b.placedAt;
      const pop = age < 8 ? 0.7 + 0.3 * Math.sin((age / 8) * Math.PI * 0.5) + 0.08 * Math.sin((age / 8) * Math.PI) : 1;
      view.root.scale.setScalar(pop);
      view.root.position.set(tileWorldX(b.tile), BOMB_R, tileWorldZ(b.tile));
      if (b.fuse !== null) {
        const urgency = 1 - b.fuse / BOMB_TILE_TICKS;
        const amp = 0.08 + 0.32 * urgency;
        view.root.rotation.z = Math.sin(nowSec * 38) * amp;
        view.root.rotation.x = Math.cos(nowSec * 31) * amp * 0.7;
        view.root.scale.setScalar(pop * (1 + 0.1 * urgency * Math.abs(Math.sin(nowSec * 30))));
      } else {
        view.root.rotation.set(0, 0, 0);
      }
    }
    for (const [id, view] of this.bombViews) {
      if (view.root.userData.seen !== tick) this.releaseBomb(id, view);
    }
  }
}
