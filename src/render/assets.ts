// Textures: photographic wood generated offline (scripts/textures, served from public/textures)
// and small procedural canvases (yarn patterns, particles, glyphs). Loaded once, shared by every
// material; the photographic ones appear as soon as they decode.
import * as THREE from 'three';
import { palette, type CordPattern } from './palette';

const loader = new THREE.TextureLoader();
const base = import.meta.env.BASE_URL ?? './';
const cache = new Map<string, THREE.Texture>();
/** Variants waiting for their file to decode: they share its image and are flagged on load. */
const waiting = new Map<string, THREE.Texture[]>();

export interface TextureVariant {
  readonly repeat?: readonly [number, number];
  readonly rotation?: number;
}

function loadFile(file: string, colorSpace: THREE.ColorSpace): THREE.Texture {
  const hit = cache.get(file);
  if (hit) return hit;
  waiting.set(file, []);
  const tex = loader.load(`${base}textures/${file}`, () => {
    // Variants were cloned before the image existed: upload them now, never before.
    for (const v of waiting.get(file) ?? []) v.needsUpdate = true;
    waiting.delete(file);
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = colorSpace;
  cache.set(file, tex);
  return tex;
}

/**
 * Repeating colour texture (sRGB) or normal map (linear) from public/textures, optionally with its
 * own repeat/rotation. Variants share the decoded image; none is uploaded before the file loads.
 */
export function woodTexture(name: string, kind: 'color' | 'normal' = 'color', variant?: TextureVariant): THREE.Texture {
  const file = kind === 'normal' ? `${name}-n.webp` : `${name}.webp`;
  const original = loadFile(file, kind === 'normal' ? THREE.NoColorSpace : THREE.SRGBColorSpace);
  if (!variant) return original;
  const key = `${file}|${variant.repeat?.join(',') ?? ''}|${variant.rotation ?? 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  // Not clone(): Texture.copy() flags needsUpdate, which would ask for an upload before the image exists.
  const tex = new THREE.Texture();
  tex.source = original.source;
  tex.wrapS = original.wrapS;
  tex.wrapT = original.wrapT;
  tex.anisotropy = original.anisotropy;
  tex.colorSpace = original.colorSpace;
  if (variant.repeat) tex.repeat.set(variant.repeat[0], variant.repeat[1]);
  if (variant.rotation) {
    tex.rotation = variant.rotation;
    tex.center.set(0.5, 0.5);
  }
  const pending = waiting.get(file);
  if (pending) pending.push(tex);
  else tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

/** The workshop panorama behind the board (blurred by the scene, used for reflections too). */
export function workshopPanorama(onLoad: (t: THREE.Texture) => void): void {
  loader.load(`${base}textures/workshop.webp`, (tex) => {
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    onLoad(tex);
  });
}

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  draw(ctx);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/** Deterministic noise for procedural textures (no Math.random: textures look the same every run). */
function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Yarn colour texture, white-based so the material colour tints it. u runs along the cord (one
 * texture length = YARN_REPEAT world units), v around it. Each player has a pattern (spec §17).
 */
export function yarnTexture(pattern: CordPattern): THREE.CanvasTexture {
  const W = 256;
  const H = 64;
  return canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    // Ply twist: diagonal bands of light and shade.
    const plies = pattern === 'twisted' ? 4 : 6;
    for (let i = -plies; i < plies * 3; i++) {
      const x0 = (i * W) / (plies * 2);
      const g = ctx.createLinearGradient(x0, 0, x0 + W / (plies * 2), 0);
      g.addColorStop(0, 'rgba(0,0,0,0.0)');
      g.addColorStop(0.5, pattern === 'twisted' ? 'rgba(0,0,0,0.32)' : 'rgba(0,0,0,0.12)');
      g.addColorStop(1, 'rgba(0,0,0,0.0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x0, 0);
      ctx.lineTo(x0 + W / (plies * 2), 0);
      ctx.lineTo(x0 + W / (plies * 2) - H * 0.9, H);
      ctx.lineTo(x0 - H * 0.9, H);
      ctx.closePath();
      ctx.fill();
    }
    // Fibre fuzz.
    for (let i = 0; i < 900; i++) {
      const x = hash(i) * W;
      const y = hash(i + 1000) * H;
      ctx.strokeStyle = `rgba(${hash(i + 7) > 0.5 ? '255,255,255' : '0,0,0'},${0.05 + hash(i + 3) * 0.08})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 6 + hash(i + 9) * 8, y - 3 - hash(i + 5) * 4);
      ctx.stroke();
    }
    if (pattern === 'dotted') {
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      for (let i = 0; i < 4; i++) {
        for (const vy of [H * 0.25, H * 0.75]) {
          ctx.beginPath();
          ctx.arc(((i + (vy > H / 2 ? 0.5 : 0)) * W) / 4 + W / 8, vy, H * 0.16, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (pattern === 'braided') {
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 4;
      for (let i = 0; i < 8; i++) {
        const x = (i * W) / 8;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + W / 16, H / 2);
        ctx.lineTo(x, H);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 8; i++) {
        const x = (i * W) / 8 + 3;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + W / 16, H / 2);
        ctx.lineTo(x, H);
        ctx.stroke();
      }
    }
  });
}

/** Fine fibre normal-ish bump for yarn (linear). */
export function yarnBump(): THREE.CanvasTexture {
  const W = 256;
  const H = 64;
  return canvasTexture(
    W,
    H,
    (ctx) => {
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, W, H);
      for (let i = -8; i < 24; i++) {
        const x0 = (i * W) / 12;
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(x0, 0);
        ctx.lineTo(x0 - H * 0.9, H);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x0 + 9, 0);
        ctx.lineTo(x0 + 9 - H * 0.9, H);
        ctx.stroke();
      }
    },
    false,
  );
}

/** Soft round particle (smoke, sawdust, glow). */
export function softDot(inner = 'rgba(255,255,255,1)', mid = 'rgba(255,255,255,0.5)'): THREE.CanvasTexture {
  return canvasTexture(128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, inner);
    g.addColorStop(0.4, mid);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  });
}

/** Spark sprite: hot core, orange halo. */
export function sparkTexture(): THREE.CanvasTexture {
  return canvasTexture(128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, palette.sparkCore);
    g.addColorStop(0.18, palette.sparkCore);
    g.addColorStop(0.4, palette.spark);
    g.addColorStop(1, 'rgba(255,120,30,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    // A few rays.
    ctx.strokeStyle = 'rgba(255,240,200,0.8)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      ctx.beginPath();
      ctx.moveTo(64 + Math.cos(a) * 14, 64 + Math.sin(a) * 14);
      ctx.lineTo(64 + Math.cos(a) * 46, 64 + Math.sin(a) * 46);
      ctx.stroke();
    }
  });
}

/** White rounded-square outline used for the death causal chain. */
export function outlineTexture(): THREE.CanvasTexture {
  return canvasTexture(128, 128, (ctx) => {
    ctx.clearRect(0, 0, 128, 128);
    ctx.strokeStyle = palette.highlight;
    ctx.lineWidth = 12;
    ctx.shadowColor = palette.highlight;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.roundRect(14, 14, 100, 100, 18);
    ctx.stroke();
  });
}

/** Action button glyph: a key cap with a bar, shown when a holder idles (spec §13). */
export function actionGlyphTexture(): THREE.CanvasTexture {
  return canvasTexture(128, 128, (ctx) => {
    ctx.clearRect(0, 0, 128, 128);
    ctx.fillStyle = palette.hudSurface;
    ctx.strokeStyle = palette.hudInk;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.roundRect(14, 30, 100, 68, 18);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = palette.hudInk;
    ctx.beginPath();
    ctx.roundRect(36, 58, 56, 12, 6);
    ctx.fill();
  });
}

/** Painted dot face (eyes + cheeks) for the peg dolls, drawn on a transparent decal. */
export function faceTexture(): THREE.CanvasTexture {
  return canvasTexture(128, 128, (ctx) => {
    ctx.clearRect(0, 0, 128, 128);
    ctx.fillStyle = palette.eye;
    for (const x of [44, 84]) {
      ctx.beginPath();
      ctx.ellipse(x, 58, 7, 9, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    for (const x of [46, 86]) {
      ctx.beginPath();
      ctx.arc(x, 55, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,140,140,0.55)';
    for (const x of [32, 96]) {
      ctx.beginPath();
      ctx.ellipse(x, 76, 9, 6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = palette.eye;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(64, 76, 8, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  });
}
