// Design tokens: the only place colours are written. The HUD reads them through CSS variables
// (applyCssTokens). Rule from GAME_SPEC §17: saturated colours belong to players, emissive
// orange-white belongs to danger (fire, blast). Wood stays in calm natural values: pale maple
// floor, dark walnut walls, pastel painted crates.
import type { PlayerId } from '../sim/types';

export const palette = {
  background: '#f3efe8',
  // Wood (multiplied with the photographic textures, so close to white keeps the real grain colour).
  maple: '#ffffff',
  mapleAlt: '#f4e8da',
  walnut: '#d9c2ae',
  walnutFrame: '#c9ad97',
  bench: '#d4c8c0',
  beadWood: '#e9c79a',
  bombWood: '#5a3a2a',
  // Pastel paints for crate blocks (spec §17: matte pastel, distinct from raw wood).
  paints: ['#f4b2c1', '#a6dcbd', '#a8cdf0', '#f5dc8e', '#cfb9f0', '#f6c19d'] as const,
  // Legacy grey tokens still used by fixtures and fallbacks.
  floor: '#e7e1d6',
  grout: '#cdc3b4',
  bomb: '#2e2b28',
  ash: '#5f5952',
  knot: '#d8c29a',
  spark: '#ffad33',
  sparkCore: '#fff3c4',
  smoke: '#b8b0a6',
  sawdust: '#e8cfa2',
  blastCore: '#ffd85a',
  blastEdge: '#ff7314',
  fireLight: '#ff9a3c',
  highlight: '#ffffff',
  shadow: '#3d3832',
  eye: '#1d1714',
  cheek: '#ff8f8f',
  // Lights.
  sunlight: '#ffeedb',
  skyFill: '#f6f4f2',
  groundFill: '#6b4e38',
  // HUD (read through CSS variables).
  hudInk: '#2f2b27',
  hudMuted: '#8a8379',
  hudSurface: '#fbf9f5',
  hudLine: '#ddd5c8',
  players: ['#d8433f', '#2f6fd6', '#e6b325', '#3c9d58'] as const,
} as const;

export type HatKind = 'cone' | 'cap' | 'knob' | 'ring';
export type CordPattern = 'plain' | 'twisted' | 'dotted' | 'braided';

/** Shape per player so colour is never the only cue (colour-blind reading, spec §17). */
export const hats: readonly HatKind[] = ['cone', 'cap', 'knob', 'ring'];
/** Cord pattern per player (spec §17: lisse, torsadée, pois, tressée). */
export const cordPatterns: readonly CordPattern[] = ['plain', 'twisted', 'dotted', 'braided'];

export function playerColor(id: PlayerId): string {
  return palette.players[id];
}

export function applyCssTokens(root: HTMLElement): void {
  const set = (name: string, value: string) => root.style.setProperty(name, value);
  set('--bg', palette.background);
  set('--ink', palette.hudInk);
  set('--muted', palette.hudMuted);
  set('--surface', palette.hudSurface);
  set('--line', palette.hudLine);
  set('--danger', palette.blastEdge);
  palette.players.forEach((c, i) => set(`--p${i}`, c));
}
