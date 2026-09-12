import type { RaceCard, RaceResult } from '../src/racing/index.js';
import { escapeHtml, formatChips, queryIn } from './ui.js';

/** Amplifie les écarts de chrono à l'écran : 1 s d'écart sur 100 s devient visible au poteau. */
const GAP_STRETCH = 7;
const FINAL_SPRINT = 0.72;

export interface RaceRunOptions {
  readonly durationMs: number;
  /** Cheval à enflammer pendant le sprint final (code ALMANACH), ou null. */
  fireHorse(standings: readonly number[]): number | null;
  onFinish(): void;
}

/**
 * Progression d'un cheval sur [0, 1] : légère accélération au départ et oscillations qui font changer la tête
 * de course. L'oscillation s'annule au départ et au poteau, et le cheval touche 1 exactement à son chrono : l'ordre
 * d'arrivée affiché est donc celui du moteur.
 */
export function progressAt(elapsedMs: number, finishMs: number, seed: number): number {
  if (elapsedMs >= finishMs) return 1;
  if (elapsedMs <= 0) return 0;
  const t = elapsedMs / finishMs;
  const wobble = 0.03 * Math.sin(Math.PI * t) * Math.sin(2 * Math.PI * t * (1.2 + (seed % 3) * 0.4) + seed * 1.7);
  return Math.min(0.999, Math.max(0, t ** 1.15 + wobble));
}

/** Piste en perspective 3D (CSS) : couloirs de gazon, poteau à damier, chevaux debout face à la caméra. */
export class RaceTrack {
  readonly #host: HTMLElement;
  #frame = 0;

  constructor(host: HTMLElement) {
    this.#host = host;
  }

  setField(card: RaceCard): void {
    this.stop();
    const markers = [25, 50, 75]
      .map((share) => `<span style="left:${share}%">${formatChips(Math.round((card.distance * share) / 100))} m</span>`)
      .join('');
    const lanes = card.horses
      .map(
        (horse) => `
          <div class="rc-lane">
            <div class="rc-runner" data-runner="${horse.number}" style="--silk:${horse.silk};--p:0">
              <span class="rc-trail" aria-hidden="true"></span>
              <span class="rc-mount"><span class="rc-horse" aria-hidden="true">🐎</span><span class="rc-bib">${horse.number}</span></span>
            </div>
          </div>`,
      )
      .join('');
    this.#host.innerHTML = `
      <div class="rc-scene">
        <div class="rc-crowd" aria-hidden="true"></div>
        <div class="rc-track" style="--lanes:${card.horses.length}">
          <div class="rc-markers" aria-hidden="true">${markers}</div>
          <div class="rc-finish" aria-hidden="true"></div>
          ${lanes}
        </div>
        <ol class="rc-live" data-live></ol>
        <p class="rc-commentary" data-commentary aria-live="polite">Les partants entrent dans les stalles.</p>
      </div>`;
  }

  run(card: RaceCard, result: RaceResult, options: RaceRunOptions): void {
    this.stop();
    const names = new Map(card.horses.map((horse) => [horse.number, horse.name]));
    const label = (number: number | undefined): string => (number === undefined ? '' : `N°${number} ${names.get(number) ?? ''}`);
    const winnerTime = result.times[0]?.centiseconds ?? 1;
    const finishMs = new Map(
      result.times.map((time) => [time.number, options.durationMs * (1 + ((time.centiseconds - winnerTime) / winnerTime) * GAP_STRETCH)]),
    );
    const lastFinish = Math.max(...finishMs.values());
    const runners = [...this.#host.querySelectorAll<HTMLElement>('[data-runner]')];
    const live = queryIn<HTMLElement>(this.#host, '[data-live]');
    const commentary = queryIn<HTMLElement>(this.#host, '[data-commentary]');
    const rank = new Map(result.order.map((number, index) => [number, index]));
    const announced = new Set<string>();
    const announce = (key: string, text: string): void => {
      if (announced.has(key)) return;
      announced.add(key);
      commentary.textContent = text;
    };
    const scene = this.#host.querySelector<HTMLElement>('.rc-scene');
    scene?.classList.add('rc-racing');
    const start = performance.now();

    const step = (now: number): void => {
      const elapsed = now - start;
      const progress = new Map([...finishMs].map(([number, finish]) => [number, progressAt(elapsed, finish, number)]));
      const standings = [...progress]
        .sort(([a, pa], [b, pb]) => pb - pa || (rank.get(a) ?? 0) - (rank.get(b) ?? 0))
        .map(([number]) => number);
      const share = elapsed / options.durationMs;
      const fire = share >= FINAL_SPRINT ? options.fireHorse(standings) : null;

      for (const runner of runners) {
        const number = Number(runner.dataset['runner']);
        const p = progress.get(number) ?? 0;
        runner.style.setProperty('--p', p.toFixed(4));
        runner.classList.toggle('rc-on-fire', fire === number && p < 1);
        runner.classList.toggle('rc-finished', p >= 1);
      }
      live.innerHTML = standings
        .slice(0, 4)
        .map((number, index) => `<li><span class="rc-live-rank">${index + 1}</span>${escapeHtml(label(number))}</li>`)
        .join('');

      if (share > 0.02) announce('start', 'Les stalles s’ouvrent… c’est parti !');
      if (share > 0.35) announce('third', `Au passage des ${formatChips(Math.round(card.distance * 0.35))} m, ${label(standings[0])} mène le peloton.`);
      if (share > 0.62) announce('half', `${label(standings[0])} garde la tête, ${label(standings[1])} revient fort !`);
      if (share > 0.85) announce('straight', `Dernière ligne droite ! ${label(standings[0])} et ${label(standings[1])} au coude-à-coude !`);
      if (share >= 1) announce('finish', `Victoire de ${label(result.order[0])} !`);

      if (elapsed < lastFinish + 500) {
        this.#frame = requestAnimationFrame(step);
      } else {
        this.#frame = 0;
        scene?.classList.remove('rc-racing');
        options.onFinish();
      }
    };
    this.#frame = requestAnimationFrame(step);
  }

  stop(): void {
    if (this.#frame !== 0) cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  }
}
