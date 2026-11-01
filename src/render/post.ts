// Post-processing chain and quality tiers: MSAA scene render → ambient occlusion (high only) →
// bloom (fire and blasts only: they are the only HDR colours) → tilt-shift that blurs everything
// outside the board's screen rectangle, plus a soft vignette → tone mapping and sRGB output.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

export type Quality = 'high' | 'medium' | 'low';
export const QUALITIES: readonly Quality[] = ['high', 'medium', 'low'];

const TiltShiftShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uRect: { value: new THREE.Vector4(0.2, 0.2, 0.8, 0.8) },
    uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
    uMaxBlur: { value: 22.0 },
    uVignette: { value: 0.32 },
    uAspect: { value: 1.6 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec4 uRect;
    uniform vec2 uTexel;
    uniform float uMaxBlur;
    uniform float uVignette;
    uniform float uAspect;
    varying vec2 vUv;
    const int TAPS = 16;
    void main() {
      // Distance outside the board rectangle, in screen-height units.
      vec2 d = max(max(uRect.xy - vUv, vUv - uRect.zw), 0.0);
      d.x *= uAspect;
      float outside = length(d);
      float radius = uMaxBlur * smoothstep(0.0, 0.08, outside);
      vec4 col = texture2D(tDiffuse, vUv);
      if (radius > 0.5) {
        vec4 acc = col;
        float golden = 2.39996323;
        for (int i = 1; i < TAPS; i++) {
          float r = sqrt(float(i) / float(TAPS)) * radius;
          float a = float(i) * golden;
          acc += texture2D(tDiffuse, vUv + vec2(cos(a), sin(a)) * r * uTexel);
        }
        col = acc / float(TAPS);
      }
      vec2 c = (vUv - 0.5) * vec2(uAspect, 1.0);
      float v = smoothstep(0.55, 1.25, length(c));
      col.rgb *= 1.0 - uVignette * v;
      gl_FragColor = col;
    }
  `,
};

export class Post {
  readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly ao: GTAOPass;
  private readonly bloom: UnrealBloomPass;
  private readonly tilt: ShaderPass;
  private quality: Quality = 'high';

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
  ) {
    const target = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.renderPass = new RenderPass(scene, camera);
    this.ao = new GTAOPass(scene, camera, 2, 2);
    this.ao.updateGtaoMaterial({ radius: 0.5, distanceExponent: 1.4, thickness: 1.2, scale: 1.1, samples: 12 });
    this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    this.ao.blendIntensity = 0.85;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 1.15);
    this.tilt = new ShaderPass(TiltShiftShader);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.ao);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.tilt);
    this.composer.addPass(new OutputPass());
  }

  get level(): Quality {
    return this.quality;
  }

  setQuality(q: Quality): void {
    this.quality = q;
    this.ao.enabled = q === 'high';
    this.tilt.uniforms.uMaxBlur!.value = q === 'low' ? 0 : 22;
  }

  /** Device pixel ratio for a quality tier. */
  static pixelRatio(q: Quality): number {
    const dpr = window.devicePixelRatio || 1;
    return q === 'high' ? Math.min(dpr, 2) : q === 'medium' ? Math.min(dpr, 1.5) : 1;
  }

  setSize(w: number, h: number): void {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    this.tilt.uniforms.uTexel!.value.set(1 / (w * pr), 1 / (h * pr));
    this.tilt.uniforms.uAspect!.value = w / h;
  }

  /** Board rectangle in UV space (0..1, y up) for the tilt-shift focus. */
  setFocusRect(minX: number, minY: number, maxX: number, maxY: number): void {
    this.tilt.uniforms.uRect!.value.set(minX, minY, maxX, maxY);
  }

  render(dt: number): void {
    this.composer.render(dt);
  }
}
