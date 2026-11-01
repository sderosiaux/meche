// Shared contract between sim, render, audio, input and bots. Owned by the sim.
// Everything here is plain data: GameState must survive structuredClone and JSON.

export type PlayerId = 0 | 1 | 2 | 3;
export type Dir = 'up' | 'down' | 'left' | 'right';

/** Index into the cell grid: y * GRID_W + x. */
export type Tile = number;

/** One player's input for one tick. `action` is an edge: true only on the tick the button went down. */
export interface PlayerInput {
  readonly dir: Dir | null;
  readonly action: boolean;
}

/** Indexed by PlayerId; undefined for absent players or no input. */
export type TickInputs = ReadonlyArray<PlayerInput | undefined>;

export type Cell = 'floor' | 'frame' | 'pillar' | 'crate';

export interface Player {
  readonly id: PlayerId;
  alive: boolean;
  /** Center position in sub-units. Tile center = tileCoord * SUB + SUB / 2. */
  x: number;
  y: number;
  facing: Dir;
  moving: boolean;
  bombsMax: number;
  range: number;
  cordMax: number;
  speed: number; // sub/tick
  heldCord: number | null; // cord id
  /** Tick at which the held cord last grew or was rewound; drives the "press Action" hint. */
  heldSince: number | null;
  diedAt: number | null;
}

export interface Bomb {
  readonly id: number;
  readonly owner: PlayerId;
  readonly tile: Tile;
  readonly cordId: number;
  /** Ticks left before the blast once fire reached the bomb tile; null while not burning. */
  fuse: number | null;
  /** Players standing on the tile when it was placed; they may walk off it, nobody may walk on. */
  walkableBy: PlayerId[];
  readonly placedAt: number;
  /** Set with `fuse`: the fire that reached the bomb tile, recorded as the explosion trigger. */
  fireCause?: { readonly ignition: Ignition; readonly trail: readonly Tile[] } | null;
}

export interface CordNode {
  readonly tile: Tile;
  burnt: boolean;
}

export interface Cord {
  readonly id: number;
  readonly owner: PlayerId;
  readonly bombId: number;
  /** nodes[0] is the bomb tile. While held, the last node is the holder's tile (hand end). */
  nodes: CordNode[];
  held: boolean;
}

export type IgnitionKind =
  | 'hand' // holder pressed Action
  | 'max-length' // cord reached cordMax
  | 'holder-died' // holder eliminated while holding
  | 'walked-into-fire' // holder laid the cord on a burning tile
  | 'blast'; // an explosion covered a cord tile

/** Root cause of a fire. Jumps between cords keep the root and extend the trail. */
export interface Ignition {
  readonly kind: IgnitionKind;
  /** Player responsible: the holder for hand/max-length/holder-died/walked-into-fire, the bomb owner for blast. */
  readonly by: PlayerId | null;
  readonly tile: Tile;
  readonly tick: number;
  /** For kind 'blast': the explosion that lit it. */
  readonly explosionId: number | null;
}

export interface FireFront {
  readonly id: number;
  readonly cordId: number;
  /** Node index the front left, and the adjacent node index it moves toward. */
  readonly from: number;
  readonly to: number;
  /** Sub-units travelled from `from` toward `to`, 0..SUB. */
  progress: number;
  readonly ignition: Ignition;
  /** Tiles visited since the ignition, ignition tile first, including jumps to other cords. */
  readonly trail: readonly Tile[];
}

export type ExplosionTrigger =
  | { readonly kind: 'fire'; readonly ignition: Ignition; readonly trail: readonly Tile[] }
  | { readonly kind: 'chain'; readonly byExplosion: number };

export interface Explosion {
  readonly id: number;
  readonly bombId: number;
  readonly owner: PlayerId;
  readonly tile: Tile;
  /** Every tile covered by the cross, bomb tile included. */
  readonly tiles: readonly Tile[];
  readonly tick: number;
  readonly trigger: ExplosionTrigger;
}

export interface Blast {
  readonly explosionId: number;
  readonly tiles: readonly Tile[];
  ticksLeft: number;
}

export interface Death {
  readonly player: PlayerId;
  readonly tick: number;
  readonly explosionId: number;
}

export type Phase = 'countdown' | 'playing' | 'resolving' | 'over';

export type SimEvent =
  | { readonly t: 'bomb-placed'; readonly bombId: number; readonly player: PlayerId; readonly tile: Tile }
  | { readonly t: 'action-denied'; readonly player: PlayerId }
  | { readonly t: 'cord-extended'; readonly cordId: number; readonly player: PlayerId; readonly tile: Tile; readonly length: number }
  | { readonly t: 'cord-rewound'; readonly cordId: number; readonly player: PlayerId; readonly length: number }
  | { readonly t: 'cord-lit'; readonly cordId: number; readonly ignition: Ignition }
  | { readonly t: 'fire-jump'; readonly tile: Tile; readonly fromCord: number; readonly toCord: number }
  | { readonly t: 'hand-burnt'; readonly cordId: number; readonly player: PlayerId }
  | { readonly t: 'bomb-fuse'; readonly bombId: number }
  | { readonly t: 'explosion'; readonly explosionId: number }
  | { readonly t: 'crate-destroyed'; readonly tile: Tile }
  | { readonly t: 'player-died'; readonly player: PlayerId; readonly explosionId: number }
  | { readonly t: 'round-over'; readonly winner: PlayerId | null };

export interface RoundConfig {
  readonly seed: number;
  /** Players taking part, 2 to 4. Spawn corners: 0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right. */
  readonly players: readonly PlayerId[];
}

export interface GameState {
  readonly config: RoundConfig;
  tick: number;
  phase: Phase;
  /** Ticks spent in the current phase. */
  phaseTick: number;
  /** Gameplay frozen while > 0 (death hit-stop). */
  freeze: number;
  rng: number;
  nextId: number;
  cells: Cell[];
  /** Indexed by PlayerId; null for players not in the round. */
  players: (Player | null)[];
  bombs: Bomb[];
  cords: Cord[];
  fronts: FireFront[];
  blasts: Blast[];
  /** Every explosion of the round, kept for the death causal chain. */
  explosions: Explosion[];
  deaths: Death[];
  winner: PlayerId | null;
  /** Events produced by the step that created this state. */
  events: SimEvent[];
}

/** What happens if nobody presses anything for `horizon` ticks (held cords stay held, nobody dies). */
export interface Forecast {
  readonly horizon: number;
  /** Per tile: first tick offset (0..horizon) at which a blast covers it, -1 if none. */
  readonly blastAt: Int16Array;
  /** Per tile: last tick offset at which a blast still covers it, -1 if none. */
  readonly blastUntil: Int16Array;
  readonly explosions: ReadonlyArray<{ readonly bombId: number; readonly at: number; readonly tiles: readonly Tile[] }>;
}
