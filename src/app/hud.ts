// DOM overlay: player strip, clock, countdown, round result, menus, debug readout.
// In-round information is iconic (spec principle: no text during play); menus may use words.
// Look: wooden toy box (maple, walnut, pyrographed lettering, paper labels). Every colour is a
// CSS variable from the token block in style.css, or a player colour (--p0..--p3) from palette.ts.
import type { BotLevel } from '../bots/api';
import { COUNTDOWN_TICKS, TICK_HZ } from '../sim/constants';
import type { GameState, PlayerId } from '../sim/types';
import { hats, type HatKind } from '../render/palette';
import { WINS_TO_TAKE, type MatchState } from './match';

const NAMES = ['Rouge', 'Bleu', 'Jaune', 'Vert'] as const;

/** Gradients shared by every doll and bead; referenced by id, so injected once in the HUD root. */
const DEFS = `<svg class="defs" width="0" height="0" aria-hidden="true" focusable="false"><defs>
  <radialGradient id="ui-gloss" cx="34%" cy="28%" r="58%">
    <stop offset="0" style="stop-color: var(--ui-gloss); stop-opacity: .9"/>
    <stop offset=".55" style="stop-color: var(--ui-gloss); stop-opacity: 0"/>
  </radialGradient>
  <radialGradient id="ui-shade" cx="42%" cy="30%" r="78%">
    <stop offset=".55" style="stop-color: var(--ui-burn); stop-opacity: 0"/>
    <stop offset="1" style="stop-color: var(--ui-burn); stop-opacity: .38"/>
  </radialGradient>
</defs></svg>`;

const PAINT_DARK = 'fill: color-mix(in srgb, currentColor 70%, var(--ui-burn))';

function hatSvg(kind: HatKind, top: number): string {
  // `top` is the y of the head's crown; hats sit on it.
  switch (kind) {
    case 'cone':
      return `<path d="M16 ${top - 11} L22.5 ${top + 1.5} Q16 ${top + 4} 9.5 ${top + 1.5} Z" style="${PAINT_DARK}"/>
        <circle cx="16" cy="${top - 11}" r="1.6" style="${PAINT_DARK}"/>`;
    case 'cap':
      return `<path d="M9.5 ${top + 2} Q9.5 ${top - 5} 16 ${top - 5} Q22.5 ${top - 5} 22.5 ${top + 2} Z" style="${PAINT_DARK}"/>
        <rect x="15" y="${top - 1}" width="11" height="3" rx="1.5" style="${PAINT_DARK}"/>`;
    case 'knob':
      return `<rect x="15" y="${top - 4}" width="2" height="5" rx="1" style="${PAINT_DARK}"/>
        <circle cx="16" cy="${top - 5.5}" r="3.6" style="${PAINT_DARK}"/>
        <circle cx="16" cy="${top - 5.5}" r="3.6" fill="url(#ui-gloss)"/>`;
    case 'ring':
      return `<ellipse cx="16" cy="${top - 4.5}" rx="8" ry="2.6" fill="none" style="stroke: color-mix(in srgb, currentColor 70%, var(--ui-burn))" stroke-width="2.2"/>`;
  }
}

function headSvg(id: PlayerId, cy: number, r: number): string {
  const top = cy - r;
  const eyeY = cy + r * 0.12;
  return `${hatSvg(hats[id] ?? 'cone', top)}
    <circle cx="16" cy="${cy}" r="${r}" fill="currentColor"/>
    <circle cx="16" cy="${cy}" r="${r}" fill="url(#ui-shade)"/>
    <circle cx="16" cy="${cy}" r="${r}" fill="url(#ui-gloss)"/>
    <ellipse cx="${16 - r * 0.33}" cy="${eyeY}" rx="${r * 0.1}" ry="${r * 0.14}" style="fill: var(--ui-ink)"/>
    <ellipse cx="${16 + r * 0.33}" cy="${eyeY}" rx="${r * 0.1}" ry="${r * 0.14}" style="fill: var(--ui-ink)"/>
    <circle cx="${16 - r * 0.55}" cy="${eyeY + r * 0.3}" r="${r * 0.14}" style="fill: var(--ui-blush); opacity: .55"/>
    <circle cx="${16 + r * 0.55}" cy="${eyeY + r * 0.3}" r="${r * 0.14}" style="fill: var(--ui-blush); opacity: .55"/>`;
}

/** Painted peg-doll head (chips), or the whole peg doll with `full` (result, podium). */
export function dollSvg(id: PlayerId, size = 30, full = false): string {
  const label = `aria-label="${NAMES[id]}" role="img"`;
  if (!full) {
    return `<svg class="doll" viewBox="0 0 32 32" width="${size}" height="${size}" style="color: var(--p${id})" ${label}>
      ${headSvg(id, 19.5, 10)}</svg>`;
  }
  const h = Math.round(size * 1.6);
  return `<svg class="doll full" viewBox="0 0 32 52" width="${size}" height="${h}" style="color: var(--p${id})" ${label}>
    <ellipse cx="16" cy="49" rx="11" ry="2.4" style="fill: var(--ui-burn); opacity: .18"/>
    <path d="M10.5 26 Q16 23.5 21.5 26 L24.5 44 Q24.5 48.5 16 48.5 Q7.5 48.5 7.5 44 Z" fill="currentColor"/>
    <path d="M10.5 26 Q16 23.5 21.5 26 L24.5 44 Q24.5 48.5 16 48.5 Q7.5 48.5 7.5 44 Z" fill="url(#ui-shade)"/>
    <path d="M10.5 26 Q16 23.5 21.5 26 L24.5 44 Q24.5 48.5 16 48.5 Q7.5 48.5 7.5 44 Z" fill="url(#ui-gloss)"/>
    ${headSvg(id, 17, 9)}</svg>`;
}

const CROWN = `<svg class="crown" viewBox="0 0 32 20" width="54" height="34" aria-hidden="true">
  <path d="M3 17 L5 5 L11 11 L16 2 L21 11 L27 5 L29 17 Z" style="fill: var(--ui-gold); stroke: var(--ui-gold-deep)" stroke-width="1.2" stroke-linejoin="round"/>
  <path d="M3 17 L5 5 L11 11 L16 2 L21 11 L27 5 L29 17 Z" fill="url(#ui-gloss)"/>
  <circle cx="16" cy="13" r="1.8" style="fill: var(--ui-gold-deep)"/></svg>`;

const ARROWS = { left: 'M10 3 L5 8 L10 13', right: 'M6 3 L11 8 L6 13', up: 'M3 10 L8 5 L13 10', down: 'M3 6 L8 11 L13 6' } as const;
const arrowKey = (dir: keyof typeof ARROWS, label: string) =>
  `<kbd aria-label="${label}"><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="${ARROWS[dir]}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></kbd>`;
const key = (label: string) => `<kbd>${label}</kbd>`;

/** A small cord with a spark: the brand mark under the title. */
const FUSE_MARK = `<svg class="fuse-mark" viewBox="0 0 220 28" width="220" height="28" aria-hidden="true">
  <path class="fuse-cord" d="M4 18 C34 4, 52 26, 82 14 S132 4, 160 16 S196 22, 206 12" fill="none" stroke-width="3.2" stroke-linecap="round"/>
  <circle class="fuse-spark-halo" cx="207" cy="11.5" r="7"/><circle class="fuse-spark" cx="207" cy="11.5" r="3"/></svg>`;

export interface MenuChoice {
  bots: 1 | 2 | 3;
  level: BotLevel;
}

interface ChipView {
  readonly el: HTMLElement;
  readonly beads: readonly HTMLElement[];
  alive: boolean | null;
  wins: number;
}

function chipLabel(id: PlayerId, alive: boolean, wins: number): string {
  return `${NAMES[id]}${id === 0 ? ' (toi)' : ''}, ${alive ? 'en jeu' : 'éliminé'}, ${wins} manche${wins > 1 ? 's' : ''}`;
}

export class Hud {
  private readonly strip: HTMLElement;
  private readonly clock: HTMLElement;
  private readonly countdown: HTMLElement;
  private readonly result: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly debugBox: HTMLElement;
  private readonly errorBox: HTMLElement;
  private chipsFor = '';
  private readonly chips = new Map<PlayerId, ChipView>();
  private resultKey = '';
  private clockText = '';
  private countdownLeft = -1;
  /** Playing time shown on the clock: phaseTick while playing, frozen afterwards (matches the timeout). */
  private playedTicks = 0;
  debugVisible = false;

  constructor(root: HTMLElement) {
    root.innerHTML = `${DEFS}
      <div class="hud-strip" hidden><div class="chips left"></div><div class="clock" aria-label="Temps de jeu">0:00</div><div class="chips right"></div></div>
      <div class="countdown" hidden aria-live="polite"></div>
      <div class="result" hidden aria-live="polite"></div>
      <div class="overlay" hidden></div>
      <div class="error" hidden role="alert"></div>
      <pre class="debug" hidden></pre>`;
    this.strip = root.querySelector('.hud-strip')!;
    this.clock = root.querySelector('.clock')!;
    this.countdown = root.querySelector('.countdown')!;
    this.result = root.querySelector('.result')!;
    this.overlay = root.querySelector('.overlay')!;
    this.errorBox = root.querySelector('.error')!;
    this.debugBox = root.querySelector('.debug')!;
  }

  update(state: GameState | null, match: MatchState | null): void {
    if (!state || !match) {
      this.strip.hidden = true;
      this.countdown.hidden = true;
      return;
    }
    this.strip.hidden = false;
    this.syncChips(state);
    for (const p of state.players) {
      if (!p) continue;
      const chip = this.chips.get(p.id);
      if (!chip) continue;
      const wins = match.wins[p.id] ?? 0;
      let changed = false;
      if (chip.alive !== p.alive) {
        // A death in the middle of a round pulses the chip; a reset at round start does not.
        if (chip.alive === true && !p.alive) restartAnimation(chip.el, 'just-died');
        chip.alive = p.alive;
        chip.el.classList.toggle('dead', !p.alive);
        changed = true;
      }
      if (chip.wins !== wins) {
        chip.beads.forEach((bead, i) => {
          const on = i < wins;
          if (on && !bead.classList.contains('on') && chip.wins >= 0) restartAnimation(bead, 'just-won');
          bead.classList.toggle('on', on);
        });
        chip.wins = wins;
        changed = true;
      }
      if (changed) chip.el.setAttribute('aria-label', chipLabel(p.id, p.alive, wins));
    }

    if (state.phase === 'countdown') this.playedTicks = 0;
    else if (state.phase === 'playing') this.playedTicks = state.phaseTick;
    const seconds = Math.floor(this.playedTicks / TICK_HZ);
    const text = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    if (this.clockText !== text) {
      this.clockText = text;
      this.clock.textContent = text;
    }

    const left = state.phase === 'countdown' ? Math.max(0, Math.ceil((COUNTDOWN_TICKS - state.phaseTick) / TICK_HZ)) : -1;
    if (left !== this.countdownLeft) {
      this.countdownLeft = left;
      this.countdown.hidden = left <= 0;
      // Re-created on each change so the pop animation replays for 3, 2, 1.
      this.countdown.innerHTML = left > 0 ? `<div class="count-token"><span>${left}</span></div>` : '';
    }
  }

  private syncChips(state: GameState): void {
    let key = '';
    for (const p of state.players) if (p) key += p.id;
    if (key === this.chipsFor) return;
    this.chipsFor = key;
    const ids = state.players.filter((p) => p !== null).map((p) => p!.id);
    const half = Math.ceil(ids.length / 2);
    const chip = (id: PlayerId) =>
      `<div class="chip${id === 0 ? ' you' : ''}" data-id="${id}" style="--pc: var(--p${id})" role="group">
        <span class="socket">${dollSvg(id, 30)}</span>
        <span class="beads">${'<i class="bead"></i>'.repeat(WINS_TO_TAKE)}</span></div>`;
    this.strip.querySelector('.left')!.innerHTML = ids.slice(0, half).map(chip).join('');
    this.strip.querySelector('.right')!.innerHTML = ids.slice(half).map(chip).join('');
    this.chips.clear();
    for (const id of ids) {
      const el = this.strip.querySelector<HTMLElement>(`.chip[data-id="${id}"]`);
      if (el) this.chips.set(id, { el, beads: [...el.querySelectorAll<HTMLElement>('.bead')], alive: null, wins: -1 });
    }
  }

  showError(message: string): void {
    this.errorBox.hidden = false;
    this.errorBox.innerHTML = `<span class="error-icon" aria-hidden="true">!</span><span></span>`;
    this.errorBox.lastElementChild!.textContent = `Erreur : ${message} (détails dans la console)`;
  }

  showResult(winner: PlayerId | null | undefined): void {
    const key = winner === undefined ? '' : String(winner);
    if (key === this.resultKey) return;
    this.resultKey = key;
    if (winner === undefined) {
      this.result.hidden = true;
      this.result.innerHTML = '';
      return;
    }
    this.result.hidden = false;
    this.result.innerHTML =
      winner === null
        ? '<div class="plaque draw-plaque" role="img" aria-label="Manche nulle"><span class="draw">=</span></div>'
        : `<div class="result-stage" style="--pc: var(--p${winner})"><span class="rays" aria-hidden="true"></span>
            <div class="plaque win-plaque" role="img" aria-label="${NAMES[winner]} gagne la manche">${CROWN}${dollSvg(winner, 80, true)}</div></div>`;
  }

  showMenu(choice: MenuChoice): void {
    this.overlay.hidden = false;
    this.overlay.className = 'overlay menu';
    const botToken = (n: 1 | 2 | 3) => {
      const on = choice.bots === n;
      const heads = ([1, 2, 3] as const).slice(0, n).map((id) => dollSvg(id, 18)).join('');
      return `<button class="token${on ? ' on' : ''}" data-choice="bots:${n}" role="radio" aria-checked="${on}" aria-label="${n} adversaire${n > 1 ? 's' : ''}">
        <span class="token-num">${n}</span><span class="token-heads">${heads}</span></button>`;
    };
    const levelToken = (level: BotLevel, label: string) => {
      const on = choice.level === level;
      return `<button class="token wide${on ? ' on' : ''}" data-choice="level:${level}" role="radio" aria-checked="${on}">${label}</button>`;
    };
    this.overlay.innerHTML = `
      <div class="lid" role="dialog" aria-labelledby="lid-title">
        <span class="screw tl"></span><span class="screw tr"></span><span class="screw bl"></span><span class="screw br"></span>
        <div class="lid-panel">
          <h1 class="brand" id="lid-title">MÈCHE</h1>
          ${FUSE_MARK}
          <p class="tagline">Le compte à rebours, c'est toi qui le dessines.</p>
          <div class="label-card">
            <span class="pin" aria-hidden="true"></span>
            <div class="opt-row">
              <span class="opt-name" id="opt-bots">Adversaires</span>
              <div class="tokens" role="radiogroup" aria-labelledby="opt-bots">${botToken(1)}${botToken(2)}${botToken(3)}</div>
              <span class="opt-keys">${arrowKey('left', 'flèche gauche')}${arrowKey('right', 'flèche droite')}</span>
            </div>
            <div class="opt-row">
              <span class="opt-name" id="opt-level">Niveau</span>
              <div class="tokens" role="radiogroup" aria-labelledby="opt-level">${levelToken('facile', 'Facile')}${levelToken('moyen', 'Moyen')}</div>
              <span class="opt-keys">${arrowKey('up', 'flèche haut')}${arrowKey('down', 'flèche bas')}</span>
            </div>
          </div>
          <button class="play" data-choice="play">Jouer ${key('Espace')}</button>
        </div>
      </div>
      <ul class="controls-hint" aria-label="Commandes">
        <li>${key('Z')}${key('Q')}${key('S')}${key('D')}<span class="or">ou</span>flèches<em>se déplacer</em></li>
        <li>${key('Espace')}<em>poser, puis allumer</em></li>
        <li>${key('A')}${key('E')}<span class="or">ou</span>glisser<em>tourner la vue</em></li>
        <li>${key('R')}<em>recentrer</em></li>
        <li>${key('Échap')}<em>pause</em></li>
        <li>${key('M')}<em>son</em></li>
      </ul>`;
  }

  showPause(reason: 'player' | 'hidden' | 'gamepad' = 'player'): void {
    const why =
      reason === 'hidden' ? '<p class="sub">La partie s\'est mise en pause quand l\'onglet a été masqué.</p>'
      : reason === 'gamepad' ? '<p class="sub">Manette déconnectée.</p>'
      : '';
    this.overlay.hidden = false;
    this.overlay.className = 'overlay pause';
    this.overlay.innerHTML = `<div class="card pause-card" role="dialog" aria-labelledby="pause-title">
      <span class="pin" aria-hidden="true"></span>
      <h2 id="pause-title">Pause</h2>${why}
      <p class="keys">${key('Échap')} reprendre <span class="dot">·</span> ${key('Retour arrière')} recommencer le match <span class="dot">·</span> ${key('R')} recentrer la vue</p></div>`;
  }

  showMatchOver(champion: PlayerId, match: MatchState): void {
    this.overlay.hidden = false;
    this.overlay.className = 'overlay matchover';
    const ranked = match.wins
      .map((w, id) => ({ w, id: id as PlayerId }))
      .filter(({ id }) => id <= match.setup.bots)
      .sort((a, b) => (a.id === champion ? -1 : b.id === champion ? 1 : b.w - a.w || a.id - b.id));
    // Podium order on screen: 2nd, 1st, 3rd, 4th.
    const slots = [ranked[1], ranked[0], ranked[2], ranked[3]].filter((r) => r !== undefined);
    const rankOf = (id: PlayerId) => ranked.findIndex((r) => r.id === id) + 1;
    const steps = slots
      .map(({ w, id }) => {
        const rank = rankOf(id);
        return `<div class="step rank-${rank}" style="--pc: var(--p${id})">
          ${rank === 1 ? CROWN : ''}${dollSvg(id, rank === 1 ? 58 : 44, true)}
          <div class="block" aria-label="${NAMES[id]}, ${w} manche${w > 1 ? 's' : ''}"><span class="rank">${rank}</span>
            <span class="beads">${'<i class="bead on"></i>'.repeat(w)}${'<i class="bead"></i>'.repeat(Math.max(0, WINS_TO_TAKE - w))}</span></div>
        </div>`;
      })
      .join('');
    this.overlay.innerHTML = `<div class="card podium-card" role="dialog" aria-label="Fin du match, ${NAMES[champion]} gagne">
      <span class="pin" aria-hidden="true"></span><div class="podium">${steps}</div>
      <p class="rematch">${key('Espace')} Revanche</p></div>`;
  }

  hideOverlay(): void {
    this.overlay.hidden = true;
    this.overlay.className = 'overlay';
    this.overlay.innerHTML = '';
  }

  onOverlayClick(fn: (choice: string) => void): void {
    this.overlay.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>('[data-choice]');
      if (target?.dataset.choice) fn(target.dataset.choice);
    });
  }

  setDebug(text: string | null): void {
    this.debugBox.hidden = !this.debugVisible || text === null;
    if (!this.debugBox.hidden && this.debugBox.textContent !== text) this.debugBox.textContent = text;
  }
}

function restartAnimation(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  void el.offsetWidth; // reflow so the same class replays its animation
  el.classList.add(cls);
}
