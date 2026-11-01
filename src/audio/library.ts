// Generated audio assets (scripts/audio/generate.mjs → public/audio). Files are fetched as soon as the
// game loads, and decoded once an AudioContext exists (it needs a user gesture).

export interface AssetEntry {
  readonly kind: 'sfx' | 'loop' | 'music';
  readonly files: readonly string[];
  readonly durationMs: readonly number[];
  readonly loopStartMs?: number;
  readonly loopEndMs?: number;
  readonly bpm?: number;
  readonly bars?: number;
}

interface Manifest {
  readonly version: number;
  readonly assets: Readonly<Record<string, AssetEntry>>;
}

export interface Sound {
  readonly entry: AssetEntry;
  readonly buffers: AudioBuffer[];
}

const base = `${import.meta.env.BASE_URL}audio/`;

export class AudioLibrary {
  private manifest: Manifest | null = null;
  private readonly raw = new Map<string, Promise<ArrayBuffer | null>>();
  private readonly sounds = new Map<string, Sound>();
  private warned = false;
  private decoding: Promise<void> | null = null;
  failed = 0;
  decoded = 0;
  total = 0;

  constructor() {
    void this.fetchAll();
  }

  private warnOnce(msg: string, err?: unknown): void {
    if (this.warned) return;
    this.warned = true;
    console.warn(`[audio] ${msg}`, err ?? '');
  }

  private async fetchAll(): Promise<void> {
    try {
      const res = await fetch(`${base}manifest.json`);
      if (!res.ok) throw new Error(`manifest ${res.status}`);
      this.manifest = (await res.json()) as Manifest;
    } catch (e) {
      this.warnOnce('manifest unavailable, the game stays silent', e);
      return;
    }
    for (const entry of Object.values(this.manifest.assets)) {
      for (const file of entry.files) {
        this.total++;
        this.raw.set(
          file,
          fetch(base + file)
            .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${file} ${r.status}`))))
            .catch((e: unknown) => {
              this.failed++;
              this.warnOnce(`could not load ${file}`, e);
              return null;
            }),
        );
      }
    }
  }

  /** Decodes everything once; resolves when every file is decoded or has failed. */
  decodeAll(ctx: BaseAudioContext): Promise<void> {
    this.decoding ??= this.decodeWith(ctx);
    return this.decoding;
  }

  private async decodeWith(ctx: BaseAudioContext): Promise<void> {
    // The manifest fetch may still be in flight.
    for (let i = 0; !this.manifest && i < 200; i++) await new Promise((r) => setTimeout(r, 25));
    const manifest = this.manifest;
    if (!manifest) return;
    await Promise.all(
      Object.entries(manifest.assets).map(async ([id, entry]) => {
        const buffers: AudioBuffer[] = [];
        for (const file of entry.files) {
          const data = await this.raw.get(file);
          if (!data) continue;
          try {
            buffers.push(await ctx.decodeAudioData(data.slice(0)));
            this.decoded++;
          } catch (e) {
            this.failed++;
            this.warnOnce(`could not decode ${file}`, e);
          }
        }
        if (buffers.length) this.sounds.set(id, { entry, buffers });
      }),
    );
  }

  get(id: string): Sound | undefined {
    return this.sounds.get(id);
  }
}
