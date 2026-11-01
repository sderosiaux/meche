// Pooled point particles (smoke, sawdust, embers): one draw call per system, fixed buffers,
// size in world units with perspective attenuation. Cosmetic only: never read by the sim.
import * as THREE from 'three';
import { softDot } from './assets';

export interface ParticleSpec {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Start and end size in world units. */
  size0: number;
  size1: number;
  life: number;
  r: number;
  g: number;
  b: number;
  alpha: number;
  gravity: number;
  drag: number;
}

const vertex = /* glsl */ `
  attribute float aSize;
  attribute vec4 aColor;
  uniform float uScale;
  varying vec4 vColor;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uScale / max(0.001, -mv.z);
  }
`;
const fragment = /* glsl */ `
  uniform sampler2D uMap;
  varying vec4 vColor;
  void main() {
    vec4 t = texture2D(uMap, gl_PointCoord);
    gl_FragColor = vec4(vColor.rgb, vColor.a * t.a);
    if (gl_FragColor.a < 0.004) discard;
  }
`;

export class Particles {
  readonly points: THREE.Points;
  private readonly cap: number;
  private readonly pos: Float32Array;
  private readonly size: Float32Array;
  private readonly color: Float32Array;
  private readonly pool: (ParticleSpec & { age: number; alive: boolean })[] = [];
  private cursor = 0;
  private readonly material: THREE.ShaderMaterial;

  constructor(capacity: number, additive: boolean) {
    this.cap = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.color = new Float32Array(capacity * 4);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.color, 4).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: { uMap: { value: softDot() }, uScale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    for (let i = 0; i < capacity; i++) {
      this.pool.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size0: 0, size1: 0, life: 1, r: 1, g: 1, b: 1, alpha: 1, gravity: 0, drag: 0, age: 0, alive: false });
    }
  }

  /** Pixels per world unit at distance 1 (drawing-buffer height / (2·tan(fov/2))). */
  setScale(scale: number): void {
    this.material.uniforms.uScale!.value = scale;
  }

  /** Copies `p` into the next pool slot (the oldest particle is recycled when full). */
  emit(p: ParticleSpec): void {
    const slot = this.pool[this.cursor]!;
    this.cursor = (this.cursor + 1) % this.cap;
    Object.assign(slot, p);
    slot.age = 0;
    slot.alive = true;
  }

  clear(): void {
    for (const p of this.pool) p.alive = false;
    this.points.geometry.setDrawRange(0, 0);
  }

  update(dt: number): void {
    let n = 0;
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.alive = false;
        continue;
      }
      p.vy -= p.gravity * dt;
      const k = Math.max(0, 1 - p.drag * dt);
      p.vx *= k;
      p.vy *= k;
      p.vz *= k;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.02 && p.vy < 0) {
        p.y = 0.02;
        p.vy *= -0.2;
        p.vx *= 0.5;
        p.vz *= 0.5;
      }
      const t = p.age / p.life;
      this.pos[n * 3] = p.x;
      this.pos[n * 3 + 1] = p.y;
      this.pos[n * 3 + 2] = p.z;
      this.size[n] = p.size0 + (p.size1 - p.size0) * t;
      this.color[n * 4] = p.r;
      this.color[n * 4 + 1] = p.g;
      this.color[n * 4 + 2] = p.b;
      this.color[n * 4 + 3] = p.alpha * (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85);
      n++;
    }
    const g = this.points.geometry;
    g.setDrawRange(0, n);
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
  }
}
