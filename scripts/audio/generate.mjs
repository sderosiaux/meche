// Generates Mèche's sound effects (ElevenLabs) and music (Lyria via the Gemini API) into public/audio.
// Usage: node scripts/audio/generate.mjs [--force] [--only id1,id2] [--reprocess] [--report]
//   --force      regenerate every asset (API calls)
//   --only       restrict to these asset ids (regenerates them)
//   --reprocess  re-run post-processing from the cached raw downloads, no API call
//   --report     measure the files already in public/audio and print a table, nothing else
// Adapted from the StepMania 99 pipeline (scripts/generate-sfx.mjs there): raw cache outside the repo,
// onset trimming, LUFS normalisation with a peak cap, music loops cut on bar lines with a crossfaded seam.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = path.join(projectRoot, 'public', 'audio');
const manifestPath = path.join(outDir, 'manifest.json');
// Raw downloads live outside the repo so processing tweaks can be re-applied with --reprocess for free.
const rawDir = path.join(os.tmpdir(), 'meche-audio-raw');

const ELEVEN_API = 'https://api.elevenlabs.io/v1';
const SFX_MODEL = 'eleven_text_to_sound_v2';
// ElevenLabs music is paid-plan only, so music comes from Lyria through the Gemini Interactions API.
const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';
const MUSIC_MODEL = 'lyria-3.5';
// Periodic extension on each side of a loop (its own tail before, its head after), so an MP3 decoder that
// ignores the encoder-delay header (~25 ms shift) still lands the loop points inside periodic audio.
const LOOP_PAD_MS = 100;
// The first seconds of a generation settle (intro fills, mix opening): the loop starts after this.
const MUSIC_SKIP_SEC = 10;
const MUSIC_XFADE_SEC = 0.03;
const RATE = 44100;

// Integrated-loudness targets (LUFS); gainDb is an offset from these.
const TARGET_LUFS = { sfx: -18, loop: -20, music: -16 };
const PEAK_CEILING_DB = -1;

const WOOD = 'wooden toy, dry, close-up, no music, no voice';

// The API's minimum duration is 0.5 s: shorter sounds are generated at 0.5 s and cut to maxMs.
// `variants` generates that many takes of the same prompt (separate calls) for round-robin playback.
const ASSETS = [
  // Players and cords
  { id: 'step', kind: 'sfx', variants: 3, duration: 0.5, maxMs: 110, mono: true, gainDb: -10, influence: 0.85,
    prompt: `One single small wooden peg tapping once on a wooden board, a soft but clearly audible hollow wooden knock, very short, ${WOOD}` },
  { id: 'place', kind: 'sfx', variants: 2, duration: 0.5, maxMs: 320, mono: true, gainDb: -3, influence: 0.7,
    prompt: `A polished wooden ball set down on a wooden board, one solid knock with a tiny bounce, ${WOOD}` },
  { id: 'unroll', kind: 'sfx', variants: 2, duration: 0.5, maxMs: 200, mono: true, gainDb: -12, influence: 0.6,
    prompt: 'Soft cotton yarn thread pulled off a small wooden spool, a short soft whirr with a tiny click, close-up, no music' },
  { id: 'rewind', kind: 'sfx', duration: 0.5, maxMs: 240, mono: true, gainDb: -12, influence: 0.6,
    prompt: 'Yarn thread quickly reeled back onto a small wooden spool, short soft reverse whirr, close-up, no music' },
  { id: 'spool-warning', kind: 'sfx', duration: 0.6, maxMs: 450, mono: true, gainDb: -8, influence: 0.7,
    prompt: `A nearly empty wooden bobbin spinning loose and rattling, quick dry rattle, ${WOOD}` },
  { id: 'denied', kind: 'sfx', duration: 0.5, maxMs: 90, mono: true, gainDb: -8, influence: 0.8,
    prompt: `One single dry wooden clack, two wooden sticks tapped once, very short, ${WOOD}` },

  // Fire
  { id: 'strike', kind: 'sfx', variants: 2, duration: 1.0, maxMs: 700, mono: true, gainDb: -3, influence: 0.7,
    prompt: 'A wooden match struck on a matchbox: quick scratch then ignition with a small soft whoosh of flame, close-up, no music' },
  { id: 'sizzle', kind: 'loop', duration: 2.0, mono: true, influence: 0.7,
    prompt: 'Continuous gentle fuse sizzle: a thin burning cotton fuse crackling and hissing steadily, steady texture, no music' },
  { id: 'knot', kind: 'sfx', variants: 2, duration: 0.5, maxMs: 200, mono: true, gainDb: -6, influence: 0.7,
    prompt: 'A tiny bright spark crackle with a light wooden tick, a fuse spark jumping across, very short, no music' },
  { id: 'hand-burnt', kind: 'sfx', duration: 0.5, maxMs: 300, mono: true, gainDb: -8, influence: 0.85,
    prompt: 'A short fizzing pop: a small burning fuse reaching its end and going out with a soft pop and a puff, close-up, clearly audible, no music' },
  { id: 'wobble', kind: 'sfx', duration: 0.8, maxMs: 650, mono: true, gainDb: -6, influence: 0.7,
    prompt: `A small wooden ball rattling and wobbling faster and faster on a wooden table, tense rattle, ${WOOD}` },

  // Blasts
  { id: 'boom-small', kind: 'sfx', variants: 2, duration: 1.2, maxMs: 1100, gainDb: 0, influence: 0.6,
    prompt: 'Cartoon toy explosion: a punchy hollow wooden POK pop with a soft puff of sawdust and a few small wooden blocks clattering, playful, not realistic, no fire roar, no music' },
  { id: 'boom-big', kind: 'sfx', duration: 1.6, maxMs: 1500, gainDb: 1, influence: 0.6,
    prompt: 'Big cartoon toy explosion: a deep hollow wooden THUMP pop with a puff of sawdust and many wooden toy blocks tumbling and clattering, playful, not realistic, no fire roar, no music' },
  { id: 'crate', kind: 'sfx', variants: 2, duration: 1.0, maxMs: 900, gainDb: -5, influence: 0.6,
    prompt: `A small stack of painted wooden toy blocks tumbling down and clattering on a wooden table, ${WOOD}` },
  { id: 'death', kind: 'sfx', duration: 1.4, maxMs: 1300, gainDb: -2, influence: 0.6,
    prompt: 'A wooden bowling skittle knocked over with a hollow wooden knock, immediately followed by a comic descending slide whistle, playful, no music, no voice' },

  // Round flow
  // Single woodblock prompts came back near-silent twice; a slow series of loud hits is cut to its first one.
  { id: 'count-tick', kind: 'sfx', duration: 1.5, maxMs: 220, mono: true, gainDb: -4, influence: 0.6,
    prompt: 'Three loud woodblock hits played slowly, one per half second, bright percussive wooden knocks, studio recording, no music' },
  { id: 'count-go', kind: 'sfx', duration: 1.0, maxMs: 900, gainDb: -3, influence: 0.7,
    prompt: 'A bright small brass bell ding with a woodblock accent, cheerful start signal, one ding, no music' },
  { id: 'round-win', kind: 'sfx', duration: 1.5, maxMs: 1400, gainDb: -3, influence: 0.6,
    prompt: 'Short cheerful marimba chord, three notes rolled quickly upward, warm and resonant, solo marimba' },
  { id: 'round-draw', kind: 'sfx', duration: 1.5, maxMs: 1400, gainDb: -4, influence: 0.6,
    prompt: 'Short soft marimba chord, three notes rolled gently, slightly unresolved and wistful, solo marimba' },
  { id: 'match-win', kind: 'sfx', duration: 3.0, maxMs: 3200, gainDb: -2, influence: 0.5,
    prompt: 'Short joyful wooden fanfare played on marimba and xylophone, celebratory flourish ending on a bright chord, toy orchestra' },

  // Menus
  { id: 'ui-move', kind: 'sfx', duration: 0.5, maxMs: 80, mono: true, gainDb: -8, influence: 0.8,
    prompt: 'One single soft wooden bead click, tiny toy tick, very short, no music' },
  { id: 'ui-select', kind: 'sfx', duration: 0.5, maxMs: 420, gainDb: -6, influence: 0.7,
    prompt: 'Two soft marimba notes rising, gentle confirm sound, wooden, short' },
  { id: 'ui-back', kind: 'sfx', duration: 0.5, maxMs: 360, gainDb: -7, influence: 0.7,
    prompt: 'Two soft marimba notes falling, gentle cancel sound, wooden, short' },

  // Music. Lyria has no tempo parameter: the real tempo is measured and the loop varispeeded to `bpm`.
  // match and tension share bpm and bars so the engine can crossfade between them on the same beat.
  { id: 'music-menu', kind: 'music', bpm: 100, bars: 16,
    prompt: `Instrumental cozy workshop music for a wooden toy board game menu, 100 BPM, 4/4, constant tempo. Warm marimba melody, kalimba arpeggios, light woodblock and shaker percussion, pizzicato upright bass, soft hand claps. Cheerful, gentle, charming, acoustic, intimate. Instrumental only, no vocals.
[0:00 - 1:30] One continuous groove at steady energy from the first second to the last. No intro build, no breakdown, no stops or silent breaks, no fade in, no fade out, no ending.` },
  { id: 'music-match', kind: 'music', bpm: 112, bars: 24,
    prompt: `Instrumental playful action music for a wooden toy battle game, 112 BPM, 4/4, constant tempo. Busy marimba ostinato, xylophone hooks, tight woodblock, cajon and shaker groove, walking pizzicato upright bass, kalimba accents. Mischievous, energetic, bouncy, acoustic, toy-orchestra feel. Instrumental only, no vocals.
[0:00 - 1:40] One continuous groove at full steady energy from the first second to the last. No intro build, no breakdown, no stops or silent breaks, no drop, no fade in, no fade out, no ending.` },
  { id: 'music-tension', kind: 'music', bpm: 112, bars: 24, gainDb: -1,
    prompt: `Instrumental suspenseful duel music for a wooden toy battle game, 112 BPM, 4/4, constant tempo. Low repeating marimba ostinato, ticking woodblocks like a clock, tremolo pizzicato strings, muted cajon pulse, sparse xylophone stabs. Tense, focused, playful suspense, acoustic, toy-orchestra feel. Instrumental only, no vocals.
[0:00 - 1:40] One continuous groove at steady energy from the first second to the last. No intro build, no breakdown, no stops or silent breaks, no drop, no fade in, no fade out, no ending.` },
];

const takes = (asset) => asset.variants ?? 1;
const fileName = (asset, k) => (takes(asset) > 1 ? `${asset.id}-${k + 1}.mp3` : `${asset.id}.mp3`);
const rawFile = (asset, k) => path.join(rawDir, `${fileName(asset, k).replace(/\.mp3$/, '')}.${asset.kind === 'music' ? 'wav' : 'mp3'}`);
const loopMs = (asset) => (asset.bars * 4 * 60_000) / asset.bpm;

function parseArgs(argv) {
  const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1]?.split(',').filter(Boolean) : null;
  return { force: argv.includes('--force'), reprocess: argv.includes('--reprocess'), report: argv.includes('--report'), only };
}

const calls = { sfx: 0, music: 0 };

async function generateSfx(asset) {
  calls.sfx++;
  const res = await fetch(`${ELEVEN_API}/sound-generation?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: asset.prompt,
      model_id: SFX_MODEL,
      loop: asset.kind === 'loop',
      duration_seconds: asset.duration ?? null,
      prompt_influence: asset.influence ?? 0.5,
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status} ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

async function generateMusic(asset) {
  calls.music++;
  const res = await fetch(`${GEMINI_API}/interactions`, {
    method: 'POST',
    headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MUSIC_MODEL, input: asset.prompt, response_format: { type: 'audio', mime_type: 'audio/wav' } }),
  });
  if (!res.ok) throw new Error(`Lyria ${res.status} ${await res.text()}`);
  const json = await res.json();
  const audio = json.steps?.flatMap((step) => step.content ?? []).find((c) => c.type === 'audio');
  if (!audio) throw new Error(`Lyria returned no audio (status ${json.status}, keys ${Object.keys(json).join(',')})`);
  return Buffer.from(audio.data, 'base64');
}

const generate = (asset) => (asset.kind === 'music' ? generateMusic(asset) : generateSfx(asset));

function ffmpeg(args) {
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-nostats', '-y', ...args], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 });
  } catch (e) {
    throw new Error(`ffmpeg failed: ${e.stderr?.toString().slice(-500)}`);
  }
}

function measureLoudness(file) {
  const res = execFileSync('sh', ['-c', `ffmpeg -hide_banner -nostats -i "${file}" -af ebur128,astats=metadata=0 -f null - 2>&1`]).toString();
  const lufs = Number(res.match(/Integrated loudness:\s+I:\s+(-?[\d.]+) LUFS/)?.[1]);
  const rms = Number(res.match(/Overall[\s\S]*?RMS level dB:\s+(-?[\d.]+)/)?.[1]);
  return { lufs, rms };
}

/** Loudness used for normalisation: integrated LUFS, or RMS for clips too short for ebur128's 400 ms blocks. */
function level(file) {
  const { lufs, rms } = measureLoudness(file);
  return Number.isFinite(lufs) && lufs > -69 ? { value: lufs, unit: 'LUFS' } : { value: rms, unit: 'RMS' };
}

function durationMs(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString();
  return Math.round(Number(out) * 1000);
}

function decode(file, channels = 1) {
  const raw = execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-i', file, '-ac', String(channels), '-ar', String(RATE), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  return new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
}

const peakDb = (samples) => 20 * Math.log10(samples.reduce((m, s) => Math.max(m, Math.abs(s)), 1e-9));

function leadMs(samples) {
  const threshold = 10 ** (-40 / 20);
  const idx = samples.findIndex((s) => Math.abs(s) > threshold);
  return idx < 0 ? null : (idx / RATE) * 1000;
}

// Start of the first sustained sound, in seconds; a lone click must not count as the onset.
function findOnset(samples, thresholdDb, sustainMs) {
  const win = 44; // ~1 ms
  const threshold = 10 ** (thresholdDb / 20);
  const loud = [];
  for (let i = 0; i < samples.length; i += win) {
    let m = 0;
    for (let j = i; j < Math.min(samples.length, i + win); j++) m = Math.max(m, Math.abs(samples[j]));
    loud.push(m > threshold);
  }
  const k = loud.findIndex((l, i) => l && loud.slice(i, i + sustainMs).filter(Boolean).length >= sustainMs / 2);
  if (k < 0) return 0;
  const first = samples.subarray(k * win, (k + 1) * win).findIndex((s) => Math.abs(s) > threshold);
  return (k * win + Math.max(0, first)) / RATE;
}

/** Linear gain to the target, capped by peak headroom (no limiter: it would move transients off t=0). */
function normaliseAndEncode(work, outPath, target, channels, bitrate) {
  const { value } = level(work);
  let gain = Math.min(target - value, PEAK_CEILING_DB - peakDb(decode(work, channels)));
  let samples;
  for (let attempt = 0; attempt < 4; attempt++) {
    ffmpeg(['-i', work, '-af', `volume=${gain.toFixed(2)}dB`, '-c:a', 'libmp3lame', '-b:a', bitrate, '-ar', String(RATE), outPath]);
    samples = decode(outPath, channels);
    const overshoot = peakDb(samples) - PEAK_CEILING_DB;
    if (overshoot <= 0) break;
    gain -= overshoot + 0.1;
  }
  return { before: value, gain, peak: peakDb(samples), samples, peakCapped: gain < target - value - 0.05 };
}

function postProcessSfx(asset, rawPath, outPath) {
  const work = `${rawPath}.work.wav`;
  const onset = findOnset(decode(rawPath), asset.trimDb ?? -40, 10);
  const filters = [`atrim=start=${onset.toFixed(5)}`, 'asetpts=PTS-STARTPTS', 'areverse', 'silenceremove=start_periods=1:start_threshold=-60dB:start_silence=0', 'areverse'];
  if (asset.maxMs) {
    const end = asset.maxMs / 1000;
    const fade = (asset.fadeOutMs ?? Math.min(40, asset.maxMs / 4)) / 1000;
    filters.push(`atrim=end=${end}`, `afade=t=out:st=${Math.max(0, end - fade).toFixed(4)}:d=${fade.toFixed(4)}:curve=exp`);
  }
  filters.push('afade=t=in:st=0:d=0.001');
  ffmpeg(['-i', rawPath, '-af', filters.join(','), '-ar', String(RATE), ...(asset.mono ? ['-ac', '1'] : ['-ac', '2']), work]);
  const target = TARGET_LUFS.sfx + (asset.gainDb ?? 0);
  const r = normaliseAndEncode(work, outPath, target, asset.mono ? 1 : 2, asset.mono ? '96k' : '128k');
  fs.rmSync(work, { force: true });
  return { ...r, target, lead: leadMs(r.samples) };
}

/** Writes interleaved float samples to a WAV through ffmpeg. */
function writeWav(samples, channels, file) {
  const tmp = `${file}.f32`;
  fs.writeFileSync(tmp, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
  ffmpeg(['-f', 'f32le', '-ar', String(RATE), '-ac', String(channels), '-i', tmp, '-c:a', 'pcm_f32le', file]);
  fs.rmSync(tmp, { force: true });
}

/** Wraps one period of `body` with LOOP_PAD_MS of its own tail before and head after. */
function padPeriodic(body, n, channels) {
  const pad = Math.round((LOOP_PAD_MS / 1000) * RATE);
  const file = new Float32Array((n + 2 * pad) * channels);
  file.set(body.subarray((n - pad) * channels, n * channels), 0);
  file.set(body.subarray(0, n * channels), pad * channels);
  file.set(body.subarray(0, pad * channels), (n + pad) * channels);
  return { file, pad };
}

// A loop SFX from the API's loop mode should already be one period. To be safe against a residual step,
// the last `xf` samples are folded into the head with an equal-power crossfade (same trick as the music):
// the loop becomes y[0..m) whose head is blended with y[m..n), so body[m-1] = y[m-1] runs into body[0] ≈ y[m].
function postProcessLoopSfx(asset, rawPath, outPath) {
  const channels = asset.mono ? 1 : 2;
  const y = decode(rawPath, channels);
  const xf = Math.round(0.02 * RATE);
  const n = y.length / channels - xf;
  const body = new Float32Array(n * channels);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < channels; c++) {
      if (i < xf) {
        const th = (Math.PI / 2) * (i / xf);
        body[i * channels + c] = y[i * channels + c] * Math.sin(th) + y[(n + i) * channels + c] * Math.cos(th);
      } else body[i * channels + c] = y[i * channels + c];
    }
  }
  const { file, pad } = padPeriodic(body, n, channels);
  const work = `${rawPath}.work.wav`;
  writeWav(file, channels, work);
  const target = TARGET_LUFS.loop + (asset.gainDb ?? 0);
  const r = normaliseAndEncode(work, outPath, target, channels, '128k');
  fs.rmSync(work, { force: true });
  return { ...r, target, loopStartMs: (pad / RATE) * 1000, loopEndMs: ((pad + n) / RATE) * 1000, checks: checkLoop(r.samples, pad, n, channels) };
}

function sampleRate(file) {
  return Number(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate', '-of', 'csv=p=0', file]).toString());
}

// In-place iterative radix-2 FFT.
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}

// Log energies in 32 log-spaced bands per frame, plus spectral flux.
function spectralFeatures(samples, sr, hop = 128, size = 1024) {
  const nBands = 32;
  const edges = Array.from({ length: nBands + 1 }, (_, b) => Math.round((40 * (16000 / 40) ** (b / nBands) * size) / sr));
  const window = Float32Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
  const frames = Math.floor((samples.length - size) / hop);
  const bands = new Float32Array(frames * nBands);
  const flux = new Float32Array(frames);
  const lvl = new Float32Array(frames);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < size; i++) {
      re[i] = samples[f * hop + i] * window[i];
      im[i] = 0;
    }
    fft(re, im);
    let total = 0;
    for (let b = 0; b < nBands; b++) {
      let e = 0;
      for (let k = edges[b]; k < Math.max(edges[b + 1], edges[b] + 1); k++) e += re[k] * re[k] + im[k] * im[k];
      total += e;
      const v = Math.log10(e + 1e-6);
      bands[f * nBands + b] = v;
      if (f > 0) flux[f] += Math.max(0, v - bands[(f - 1) * nBands + b]);
    }
    lvl[f] = 10 * Math.log10(total + 1e-12);
  }
  return { bands, nBands, flux, level: lvl, frames, hopSec: hop / sr, offsetSec: size / 2 / sr };
}

const interp = (arr, x) => {
  const i = Math.floor(x);
  return i < 0 || i + 1 >= arr.length ? 0 : arr[i] + (arr[i + 1] - arr[i]) * (x - i);
};

const parabolic = (a, b, c) => (a - 2 * b + c === 0 ? 0 : (0.5 * (a - c)) / (a - 2 * b + c));

function pearson(x, y) {
  const n = x.length;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += x[i];
    my += y[i];
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy + 1e-12);
}

class LoopError extends Error {}

// A loop of exactly bars*4 beats starting on a detected downbeat, chosen so that what follows one loop
// length looks most like the start itself: the seam is musically continuous.
function findLoop(feat, asset) {
  const { flux, level: lvl, frames, hopSec, offsetSec, bands, nBands } = feat;
  const sorted = Array.from(lvl).sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1];
  const smooth = Math.round(1 / hopSec);
  let usableEnd = frames - 1;
  while (usableEnd > smooth) {
    let m = 0;
    for (let i = usableEnd - smooth; i < usableEnd; i++) m += lvl[i];
    if (m / smooth >= median - 6) break;
    usableEnd -= smooth >> 2;
  }

  const t0 = Math.round(MUSIC_SKIP_SEC / hopSec);
  const acf = (lag) => {
    let s = 0;
    for (let i = t0; i + lag < usableEnd; i++) s += flux[i] * flux[i + lag];
    return s;
  };
  // Beat period within 80–160 BPM (the reference searched 100–150; 100 BPM sat on its edge).
  const lags = [];
  for (let lag = Math.floor(0.375 / hopSec); lag <= Math.ceil(0.75 / hopSec); lag++) lags.push([lag, acf(lag)]);
  const best = lags.reduce((a, b) => (b[1] > a[1] ? b : a));
  const period = best[0] + parabolic(acf(best[0] - 1), best[1], acf(best[0] + 1));

  let phase = 0;
  let phaseScore = -1;
  for (let p = 0; p < period; p += 0.25) {
    let s = 0;
    for (let t = t0 + p; t < usableEnd; t += period) s += interp(flux, t);
    if (s > phaseScore) [phase, phaseScore] = [p, s];
  }
  const beatMean = (t) => {
    const v = new Float32Array(nBands);
    const from = Math.round(t);
    for (let f = from; f < from + Math.round(period); f++) for (let b = 0; b < nBands; b++) v[b] += bands[f * nBands + b];
    return v;
  };
  const changeByBeat = [0, 1, 2, 3].map((m) => {
    let s = 0;
    let n = 0;
    for (let t = t0 + phase + (m + 4) * period; t + period < usableEnd; t += 4 * period) {
      s += 1 - pearson(beatMean(t - period), beatMean(t));
      n++;
    }
    return s / Math.max(1, n);
  });
  const downbeat = changeByBeat.indexOf(Math.max(...changeByBeat));

  const beats = asset.bars * 4;
  // The generation's own tempo decides the loop length in frames; the result is varispeeded to asset.bpm.
  const nominal = beats * period;
  const win = Math.round(4 / hopSec);
  const slice = (start) => {
    const out = new Float32Array(win * (nBands + 1));
    for (let i = 0; i < win; i++) {
      const f = Math.round(start) + i;
      for (let b = 0; b < nBands; b++) out[i * (nBands + 1) + b] = bands[f * nBands + b];
      out[i * (nBands + 1) + nBands] = flux[f] * 4;
    }
    return out;
  };
  // Lyria sometimes inserts a full stop mid-groove; windows containing one are rejected.
  const dropFrames = Math.round(0.1 / hopSec);
  const hasDropout = (from, to) => {
    let run = 0;
    for (let f = Math.floor(from); f < Math.min(to, frames); f++) {
      run = lvl[f] < median - 30 ? run + 1 : 0;
      if (run >= dropFrames) return true;
    }
    return false;
  };
  let pick = null;
  for (let start = t0 + phase + downbeat * period; start + nominal + win + 10 < usableEnd; start += 4 * period) {
    if (hasDropout(start, start + nominal + win)) continue;
    const head = slice(start);
    const scores = [];
    for (let d = -40; d <= 40; d++) scores.push(pearson(head, slice(start + nominal + d)));
    const i = scores.indexOf(Math.max(...scores));
    const refined = i > 0 && i < scores.length - 1 ? parabolic(scores[i - 1], scores[i], scores[i + 1]) : 0;
    const candidate = { start, length: nominal + (i - 40) + refined, score: scores[i] };
    if (!pick || candidate.score > pick.score) pick = candidate;
  }
  if (!pick) throw new LoopError(`no dropout-free ${asset.bars}-bar window between ${MUSIC_SKIP_SEC}s and ${(usableEnd * hopSec).toFixed(1)}s`);
  return {
    startSec: pick.start * hopSec + offsetSec - MUSIC_XFADE_SEC,
    lengthSec: pick.length * hopSec,
    score: pick.score,
    measuredBpm: (60 * beats) / (pick.length * hopSec),
    gridBpm: 60 / (period * hopSec),
    changeByBeat,
    usableEndSec: usableEnd * hopSec,
  };
}

function postProcessMusic(asset, rawPath, outPath) {
  const sr = sampleRate(rawPath);
  const loop = findLoop(spectralFeatures(decode(rawPath), RATE), asset);
  void sr;
  const n = Math.round((loopMs(asset) / 1000) * RATE);
  const xfade = Math.round(MUSIC_XFADE_SEC * RATE);

  // Varispeed the measured loop so it lasts exactly bars at asset.bpm: atempo's WSOLA would smear
  // transients, a resample only shifts pitch by the same tiny ratio.
  const stretched = `${rawPath}.stretched.f32`;
  const rate = (RATE * loop.lengthSec) / (loopMs(asset) / 1000);
  ffmpeg([
    '-i', rawPath,
    '-af', `aresample=${RATE},atrim=start=${loop.startSec.toFixed(6)}:end=${(loop.startSec + loop.lengthSec + 0.2).toFixed(6)},asetpts=PTS-STARTPTS,asetrate=${rate.toFixed(4)},aresample=${RATE}`,
    '-ac', '2', '-f', 'f32le', stretched,
  ]);
  const raw = fs.readFileSync(stretched);
  fs.rmSync(stretched, { force: true });
  const y = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
  if (y.length / 2 < n + xfade) throw new LoopError('stretched audio shorter than loop + crossfade');

  // Equal-power crossfade into the head from the audio that follows the loop end: the sample after
  // the loop's last one is its true continuation, so the seam needs no fade at either end.
  const body = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 2; c++) {
      if (i < xfade) {
        const th = (Math.PI / 2) * (i / xfade);
        body[i * 2 + c] = y[i * 2 + c] * Math.sin(th) + y[(n + i) * 2 + c] * Math.cos(th);
      } else body[i * 2 + c] = y[i * 2 + c];
    }
  }
  const { file, pad } = padPeriodic(body, n, 2);
  const work = `${rawPath}.work.wav`;
  writeWav(file, 2, work);
  const target = TARGET_LUFS.music + (asset.gainDb ?? 0);
  const r = normaliseAndEncode(work, outPath, target, 2, '128k');
  fs.rmSync(work, { force: true });
  return { ...r, target, loop, loopStartMs: LOOP_PAD_MS, loopEndMs: LOOP_PAD_MS + loopMs(asset), checks: checkLoop(r.samples, pad, n, 2) };
}

// Seam diagnostics on the decoded MP3: audio after loopEnd must equal audio after loopStart (codec noise
// only), the jump across the seam must look like any other sample step, head/tail levels must match.
function checkLoop(samples, start, n, ch) {
  const at = (i, c) => samples[i * ch + c];
  const rms = (from, len) => {
    let s = 0;
    for (let i = from; i < from + len; i++) for (let c = 0; c < ch; c++) s += at(i, c) ** 2;
    return 10 * Math.log10(s / (len * ch) + 1e-12);
  };
  const w50 = Math.round(0.05 * RATE);
  let sig = 0;
  let diff = 0;
  for (let i = 0; i < w50; i++) {
    for (let c = 0; c < ch; c++) {
      sig += at(start + i, c) ** 2;
      diff += (at(start + n + i, c) - at(start + i, c)) ** 2;
    }
  }
  const steps = [];
  for (let i = start + 1; i < start + n; i++) steps.push(Math.abs(at(i, 0) - at(i - 1, 0)));
  steps.sort((a, b) => a - b);
  const seamStep = Math.max(...Array.from({ length: ch }, (_, c) => Math.abs(at(start, c) - at(start + n - 1, c))));
  return {
    headRmsDb: +rms(start, w50).toFixed(2),
    tailRmsDb: +rms(start + n - w50, w50).toFixed(2),
    periodicSnrDb: +(10 * Math.log10(sig / (diff + 1e-12))).toFixed(1),
    seamStep: +seamStep.toFixed(4),
    p99Step: +steps[Math.floor(steps.length * 0.99)].toFixed(4),
    maxStep: +steps[steps.length - 1].toFixed(4),
  };
}

function report() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const rows = [];
  let total = 0;
  for (const [id, a] of Object.entries(manifest.assets)) {
    for (const f of a.files) {
      const p = path.join(outDir, f);
      const size = fs.statSync(p).size;
      total += size;
      const { value, unit } = level(p);
      rows.push({ file: f, kind: a.kind, ms: durationMs(p), level: `${value.toFixed(1)} ${unit}`, kb: Math.round(size / 1024), id });
    }
  }
  console.table(rows);
  console.log(`total ${(total / 1024 / 1024).toFixed(2)} MB in ${rows.length} files`);
}

async function main() {
  if (typeof fetch !== 'function') throw new Error('Node 20+ required (global fetch)');
  const { force, reprocess, report: onlyReport, only } = parseArgs(process.argv.slice(2));
  if (onlyReport) return report();
  const known = new Set(ASSETS.map((a) => a.id));
  const unknown = (only ?? []).filter((id) => !known.has(id));
  if (unknown.length) throw new Error(`Unknown ids: ${unknown.join(', ')}`);

  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(rawDir, { recursive: true });

  const targets = ASSETS.filter((a) => {
    if (only) return only.includes(a.id);
    return force || reprocess || !Array.from({ length: takes(a) }, (_, k) => fileName(a, k)).every((f) => fs.existsSync(path.join(outDir, f)));
  });
  const needsApi = targets.filter((a) => !reprocess || !fs.existsSync(rawFile(a, 0)));
  if (needsApi.some((a) => a.kind !== 'music') && !process.env.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY is not set');
  if (needsApi.some((a) => a.kind === 'music') && !process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set');

  const loopInfo = {};
  for (const asset of targets) {
    for (let k = 0; k < takes(asset); k++) {
      const rawPath = rawFile(asset, k);
      const outPath = path.join(outDir, fileName(asset, k));
      const fresh = !(reprocess && fs.existsSync(rawPath));
      if (fresh) fs.writeFileSync(rawPath, await generate(asset));
      if (asset.kind === 'music') {
        let result;
        for (let attempt = 1; !result; attempt++) {
          try {
            result = postProcessMusic(asset, rawPath, outPath);
          } catch (e) {
            if (!(e instanceof LoopError) || !fresh || attempt >= 3) throw e;
            console.log(`${asset.id}: attempt ${attempt} rejected (${e.message}), regenerating`);
            fs.writeFileSync(rawPath, await generate(asset));
          }
        }
        const { loop, before, gain, peak, checks } = result;
        loopInfo[asset.id] = { loopStartMs: result.loopStartMs, loopEndMs: result.loopEndMs };
        console.log(
          `${asset.id}: ${durationMs(outPath)} ms, loop src ${loop.startSec.toFixed(3)}s +${loop.lengthSec.toFixed(3)}s ` +
            `(measured ${loop.measuredBpm.toFixed(2)} BPM, grid ${loop.gridBpm.toFixed(2)}, seam r=${loop.score.toFixed(3)}, usable until ${loop.usableEndSec.toFixed(1)}s), ` +
            `${before.toFixed(1)} LUFS → gain ${gain.toFixed(1)} dB, peak ${peak.toFixed(1)} dB\n  checks ${JSON.stringify(checks)}`,
        );
      } else if (asset.kind === 'loop') {
        const r = postProcessLoopSfx(asset, rawPath, outPath);
        loopInfo[asset.id] = { loopStartMs: r.loopStartMs, loopEndMs: r.loopEndMs };
        console.log(`${fileName(asset, k)}: ${durationMs(outPath)} ms, level ${r.before.toFixed(1)} → ${r.target} (gain ${r.gain.toFixed(1)} dB), peak ${r.peak.toFixed(1)} dB\n  checks ${JSON.stringify(r.checks)}`);
      } else {
        const r = postProcessSfx(asset, rawPath, outPath);
        console.log(
          `${fileName(asset, k)}: ${durationMs(outPath)} ms, lead ${r.lead?.toFixed(1) ?? 'silent'} ms, peak ${r.peak.toFixed(1)} dB, ` +
            `level ${r.before.toFixed(1)} → ${r.target} (gain ${r.gain.toFixed(1)} dB${r.peakCapped ? ', peak-capped' : ''})`,
        );
      }
    }
  }

  const previous = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { assets: {} };
  const assets = {};
  for (const a of ASSETS) {
    const files = Array.from({ length: takes(a) }, (_, k) => fileName(a, k)).filter((f) => fs.existsSync(path.join(outDir, f)));
    if (!files.length) continue;
    const entry = { kind: a.kind, files, durationMs: files.map((f) => durationMs(path.join(outDir, f))) };
    if (a.kind === 'music') Object.assign(entry, { bpm: a.bpm, bars: a.bars });
    if (a.kind === 'music' || a.kind === 'loop') {
      const info = loopInfo[a.id] ?? previous.assets[a.id];
      entry.loopStartMs = info.loopStartMs;
      entry.loopEndMs = info.loopEndMs;
    }
    assets[a.id] = entry;
  }
  fs.writeFileSync(manifestPath, JSON.stringify({ version: 1, assets }, null, 2) + '\n');
  console.log(`manifest: ${Object.keys(assets).length}/${ASSETS.length} assets; API calls this run: ElevenLabs ${calls.sfx}, Lyria ${calls.music}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
