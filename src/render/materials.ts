// Shared materials, created once. Wood uses the photographic textures; colour variation per
// instance comes from instanceColor (multiplied), grain variation from a per-instance UV offset.
import * as THREE from 'three';
import { woodTexture, yarnBump, yarnTexture } from './assets';
import { cordPatterns, palette } from './palette';

/**
 * Adds a per-instance UV offset (attribute `uvOffset`) so instanced tiles show different parts of
 * the same wood texture. The attribute must be set on the geometry (InstancedBufferAttribute).
 */
function withInstanceUvOffset<T extends THREE.Material>(material: T): T {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 uvOffset;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n vMapUv += uvOffset;\n#endif\n#ifdef USE_NORMALMAP\n vNormalMapUv += uvOffset;\n#endif');
  };
  material.customProgramCacheKey = () => 'uvOffset';
  return material;
}

const rep = (r: number, r2 = r) => ({ repeat: [r, r2] as const });

export class Materials {
  readonly maple: THREE.MeshPhysicalMaterial;
  readonly walnut: THREE.MeshPhysicalMaterial;
  readonly walnutFrame: THREE.MeshPhysicalMaterial;
  readonly painted: THREE.MeshStandardMaterial;
  readonly bench: THREE.MeshStandardMaterial;
  readonly bead: THREE.MeshPhysicalMaterial;
  readonly bomb: THREE.MeshPhysicalMaterial;
  readonly hatWood: THREE.MeshPhysicalMaterial;
  readonly lacquer: THREE.MeshPhysicalMaterial[];
  readonly yarn: THREE.MeshStandardMaterial[];
  readonly ash: THREE.MeshStandardMaterial;

  constructor() {
    this.maple = withInstanceUvOffset(
      new THREE.MeshPhysicalMaterial({
        color: palette.maple,
        map: woodTexture('maple', 'color', rep(0.5)),
        normalMap: woodTexture('maple', 'normal', rep(0.5)),
        normalScale: new THREE.Vector2(0.35, 0.35),
        roughness: 0.55,
        clearcoat: 0.25,
        clearcoatRoughness: 0.5,
      }),
    );
    this.walnut = withInstanceUvOffset(
      new THREE.MeshPhysicalMaterial({
        color: palette.walnut,
        map: woodTexture('walnut', 'color', rep(0.6)),
        normalMap: woodTexture('walnut', 'normal', rep(0.6)),
        normalScale: new THREE.Vector2(0.4, 0.4),
        roughness: 0.42,
        clearcoat: 0.45,
        clearcoatRoughness: 0.35,
      }),
    );
    const frameTex = woodTexture('walnut', 'color', rep(4, 0.35));
    const frameN = woodTexture('walnut', 'normal', rep(4, 0.35));
    this.walnutFrame = new THREE.MeshPhysicalMaterial({
      color: palette.walnutFrame,
      map: frameTex,
      normalMap: frameN,
      normalScale: new THREE.Vector2(0.4, 0.4),
      roughness: 0.4,
      clearcoat: 0.5,
      clearcoatRoughness: 0.3,
    });
    this.painted = withInstanceUvOffset(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: woodTexture('painted', 'color', rep(0.7)),
        normalMap: woodTexture('painted', 'normal', rep(0.7)),
        normalScale: new THREE.Vector2(0.5, 0.5),
        roughness: 0.82,
      }),
    );
    const benchTex = woodTexture('bench', 'color', rep(8));
    const benchN = woodTexture('bench', 'normal', rep(8));
    this.bench = new THREE.MeshStandardMaterial({
      color: palette.bench,
      map: benchTex,
      normalMap: benchN,
      normalScale: new THREE.Vector2(0.6, 0.6),
      roughness: 0.75,
    });
    this.bead = new THREE.MeshPhysicalMaterial({
      color: palette.beadWood,
      map: woodTexture('maple', 'color', rep(0.25)),
      roughness: 0.35,
      clearcoat: 0.8,
      clearcoatRoughness: 0.2,
    });
    this.hatWood = new THREE.MeshPhysicalMaterial({
      color: palette.beadWood,
      map: woodTexture('maple', 'color', rep(0.3)),
      roughness: 0.4,
      clearcoat: 0.7,
      clearcoatRoughness: 0.25,
    });
    this.bomb = new THREE.MeshPhysicalMaterial({
      color: palette.bombWood,
      map: woodTexture('walnut', 'color', rep(0.35)),
      roughness: 0.28,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
    });
    this.lacquer = palette.players.map(
      (c) =>
        new THREE.MeshPhysicalMaterial({
          color: c,
          roughness: 0.32,
          clearcoat: 1,
          clearcoatRoughness: 0.08,
        }),
    );
    const bump = yarnBump();
    this.yarn = palette.players.map((c, i) => {
      const map = yarnTexture(cordPatterns[i] ?? 'plain');
      return new THREE.MeshStandardMaterial({ color: c, map, bumpMap: bump, bumpScale: 1.2, roughness: 0.92 });
    });
    this.ash = new THREE.MeshStandardMaterial({ color: palette.ash, roughness: 1 });
  }
}

let shared: Materials | null = null;
export function materials(): Materials {
  shared ??= new Materials();
  return shared;
}
