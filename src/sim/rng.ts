// mulberry32 on an int32 state. Integer-only (Math.imul), identical in every JS engine.

export function seedRng(seed: number): number {
  return (seed ^ 0x9e3779b9) | 0;
}

export function nextU32(holder: { rng: number }): number {
  holder.rng = (holder.rng + 0x6d2b79f5) | 0;
  let t = holder.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}
