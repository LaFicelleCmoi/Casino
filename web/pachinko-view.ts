import { CryptoRandomSource, chips, playerId, type PlayerId, type RandomSource } from '../src/core/index.js';
import {
  FEVER_BALLS,
  FEVER_MULTIPLIER,
  JACKPOT_ODDS,
  POCKETS,
  POCKET_TOTAL_WEIGHT,
  PachinkoController,
  STANDARD_PACHINKO_RULES,
  TOP_POCKET,
  formatPocketMultiplier,
  pocketForRoll,
  returnToPlayer,
  rollForPocket,
  type Metal,
  type PachinkoBall,
  type PachinkoCommand,
  type PachinkoState,
} from '../src/pachinko/index.js';
import { setCheatTarget } from './cheat-console.js';
import { DAILY_REFILL, claimDailyRefill, loadLedger, netOf, recordResult, saveBalance, startingBalance } from './money-ledger.js';
import { PachinkoBoard } from './pachinko-board.js';
import {
  REFILL_DONE_MESSAGE,
  REFILL_USED_MESSAGE,
  expectOk,
  formatChips,
  formatSigned,
  queryIn,
  refillButtonHtml,
  signClass,
  syncRefillButton,
} from './ui.js';

type Tone = 'info' | 'win' | 'loss' | 'error';

const PLAYER: PlayerId = playerId('vous');
const RULES = STANDARD_PACHINKO_RULES;
const CASCADE = 10;
const CASCADE_GAP_MS = 150;
const FEVER_GAP_MS = 230;
const GOLDEN_GAP_MS = 95;
const CHEAT_BALLS = 50;
const HISTORY_SIZE = 20;
const LEGEND_ORDER: readonly Metal[] = ['PLATINE', 'OR', 'ARGENT', 'BRONZE', 'BONUS'];
const LEGEND_COLORS: Readonly<Record<Metal, string>> = { BRONZE: '#cd7f32', ARGENT: '#c9d1d9', OR: '#ffd34d', PLATINE: '#dff6ff', BONUS: '#ff2fb3' };

/**
 * Aléa du Pachinko côté interface : lit à l'avance la poche de la prochaine bille (voyance) et, avec FEVERTIME,
 * guide chaque bille vers la poche Platine en forçant le premier tirage de la bille.
 */
class PachinkoRandom implements RandomSource {
  readonly #inner: RandomSource;
  readonly #queue: number[] = [];
  guided = false;

  constructor(inner: RandomSource) {
    this.#inner = inner;
  }

  nextInt(maxExclusive: number): number {
    if (maxExclusive === POCKET_TOTAL_WEIGHT) {
      if (this.guided) return rollForPocket(TOP_POCKET);
      const queued = this.#queue.shift();
      if (queued !== undefined) return queued;
    }
    return this.#inner.nextInt(maxExclusive);
  }

  peekPocketRoll(): number {
    if (this.#queue.length === 0) this.#queue.push(this.#inner.nextInt(POCKET_TOTAL_WEIGHT));
    return this.#queue[0] ?? 0;
  }
}

export function mountPachinko(root: HTMLElement): () => void {
  const rng = new PachinkoRandom(new CryptoRandomSource());
  const controller = new PachinkoController(rng);
  let state: PachinkoState = expectOk(controller.createSession(PLAYER, startingBalance('pachinko')));
  let stake = 10;
  let message = 'Choisissez la mise par bille, puis lancez : visez les poches Bonus pour le Fever Mode.';
  let tone: Tone = 'info';
  /** Gains déjà réglés par le moteur, dont la bille n'a pas encore touché le fond. */
  let pending = 0;
  let golden = false;
  let history: { multiplier: number; won: boolean; golden: boolean }[] = [];
  let cascadeTimers: number[] = [];
  let feverTimer: number | undefined;
  let resizeTimer: number | undefined;
  let disposed = false;

  const legend = LEGEND_ORDER.map((metal) => {
    const pockets = POCKETS.filter((pocket) => pocket.metal === metal);
    const chance = pockets.reduce((sum, pocket) => sum + pocket.weight, 0) / POCKET_TOTAL_WEIGHT;
    const [first] = pockets;
    const label = metal === 'BONUS' ? 'Bonus · ×1 + machine à sous' : `${first?.label ?? metal} · ×${formatPocketMultiplier(first?.multiplier ?? 0)}`;
    return `<li><span><i class="pc-swatch" style="--metal:${LEGEND_COLORS[metal]}"></i>${label}</span><span>${(chance * 100).toFixed(1).replace('.', ',')} %</span></li>`;
  }).join('');

  root.innerHTML = `
    <div class="game pc-game">
      <header class="topbar">
        <a class="back" href="#/">← Lobby</a>
        <h1>Pachinko</h1>
        <div class="topbar-stats">
          <div class="bankroll">Bilan <strong data-ledger></strong></div>
          <div class="bankroll">Solde <strong data-bankroll></strong></div>
        </div>
      </header>
      <div class="pc-layout">
        <aside class="pc-controls">
          <label class="pk-label" for="pc-stake">Mise par bille</label>
          <div class="pk-stake">
            <input id="pc-stake" type="number" min="1" step="1" inputmode="numeric" value="${stake}" data-stake>
            <button class="pk-mini" data-action="HALF" aria-label="Diviser la mise par deux">½</button>
            <button class="pk-mini" data-action="DOUBLE" aria-label="Doubler la mise">×2</button>
          </div>
          <button class="btn primary" data-action="LAUNCH">Lancer <kbd>Espace</kbd></button>
          <button class="btn" data-action="CASCADE">Pluie de ${CASCADE} billes</button>
          <div class="pc-fever" data-fever hidden>FEVER MODE · <strong data-fever-count></strong> billes</div>
          <span class="pk-label">Poches</span>
          <ul class="pc-pockets">${legend}</ul>
          <p class="pc-rtp">Retour théorique ${(returnToPlayer() * 100).toFixed(1).replace('.', ',')} % · 777 sur une poche Bonus (1 chance sur ${JACKPOT_ODDS}) : ${FEVER_BALLS} billes gratuites aux gains ×${FEVER_MULTIPLIER}</p>
          ${refillButtonHtml('pachinko', 'ghost', 'hidden')}
          <p class="message pc-message" data-message aria-live="polite"></p>
        </aside>
        <section class="pc-stage" data-stage>
          <div class="pc-history" data-history aria-label="Derniers multiplicateurs"></div>
          <canvas class="pc-board" data-board aria-label="Plateau de Pachinko"></canvas>
        </section>
      </div>
    </div>`;

  const ledgerEl = queryIn<HTMLElement>(root, '[data-ledger]');
  const bankrollEl = queryIn<HTMLElement>(root, '[data-bankroll]');
  const stakeEl = queryIn<HTMLInputElement>(root, '[data-stake]');
  const launchEl = queryIn<HTMLButtonElement>(root, '[data-action="LAUNCH"]');
  const cascadeEl = queryIn<HTMLButtonElement>(root, '[data-action="CASCADE"]');
  const feverEl = queryIn<HTMLElement>(root, '[data-fever]');
  const feverCountEl = queryIn<HTMLElement>(root, '[data-fever-count]');
  const rebuyEl = queryIn<HTMLButtonElement>(root, '[data-action="REBUY"]');
  const messageEl = queryIn<HTMLElement>(root, '[data-message]');
  const historyEl = queryIn<HTMLElement>(root, '[data-history]');
  const stageEl = queryIn<HTMLElement>(root, '[data-stage]');
  const board = new PachinkoBoard(queryIn<HTMLCanvasElement>(root, '[data-board]'));

  const safeStake = (): number => (Number.isSafeInteger(stake) && stake > 0 ? stake : 0);

  function apply(command: PachinkoCommand): PachinkoBall | null {
    const result = controller.apply(state, command);
    if (!result.ok) {
      [message, tone] = [result.error.message, 'error'];
      return null;
    }
    state = result.value.state;
    return state.lastBalls[0] ?? null;
  }

  function render(): void {
    saveBalance('pachinko', state.player.bankroll);
    bankrollEl.textContent = formatChips(state.player.bankroll - pending);
    const net = netOf(loadLedger().pachinko);
    ledgerEl.textContent = formatSigned(net);
    ledgerEl.className = signClass(net);
    messageEl.textContent = message;
    messageEl.dataset['tone'] = tone;
    const fever = state.phase === 'FEVER';
    feverEl.hidden = !fever;
    feverEl.classList.toggle('is-golden', golden);
    feverCountEl.textContent = String(state.feverBallsLeft);
    launchEl.disabled = fever;
    cascadeEl.disabled = fever;
    stageEl.classList.toggle('pc-fevering', fever);
    rebuyEl.hidden = fever || board.inFlight > 0 || state.player.bankroll >= RULES.minStake;
    syncRefillButton(rebuyEl, 'pachinko');
    historyEl.innerHTML = history
      .map((entry) => `<span class="pc-chip ${entry.golden ? 'is-gold' : entry.won ? 'is-win' : ''}">×${formatPocketMultiplier(entry.multiplier)}</span>`)
      .join('');
  }

  function landed(ball: PachinkoBall, isGolden: boolean): void {
    pending -= ball.payout;
    history = [{ multiplier: ball.multiplier, won: ball.payout > (ball.free ? 0 : ball.stake), golden: isGolden }, ...history].slice(0, HISTORY_SIZE);
    const pocket = POCKETS[ball.pocket];
    if (ball.slot !== null) {
      const slot = ball.slot;
      [message, tone] = ['Poche Bonus ! La machine à sous tourne…', 'info'];
      void board.spinSlot(slot, ball.feverTriggered).then(() => {
        if (disposed) return;
        if (ball.feverTriggered) {
          if (feverTimer === undefined) startFever(false);
        } else {
          [message, tone] = [`${slot.join(' ')} : pas de 777 cette fois.`, 'info'];
        }
        render();
      });
    } else if (!ball.free && ball.multiplier >= 1_000) {
      [message, tone] = [`${pocket?.label ?? ''} ×${formatPocketMultiplier(ball.multiplier)} : ${formatChips(ball.payout)} jetons !`, 'win'];
    }
    render();
  }

  function track(ball: PachinkoBall, isGolden: boolean): void {
    recordResult('pachinko', ball.payout - (ball.free ? 0 : ball.stake));
    pending += ball.payout;
    board.launch({ pocket: ball.pocket, golden: isGolden, fever: ball.free, onLand: () => landed(ball, isGolden) });
  }

  function launch(): boolean {
    if (state.phase === 'FEVER') {
      [message, tone] = ['Fever Mode en cours : les billes gratuites tombent.', 'info'];
      render();
      return false;
    }
    const ball = apply({ type: 'LAUNCH_BALL', playerId: PLAYER, stake: chips(safeStake()) });
    if (ball === null) {
      render();
      return false;
    }
    track(ball, false);
    render();
    return true;
  }

  function stopCascade(): void {
    cascadeTimers.forEach((timer) => window.clearTimeout(timer));
    cascadeTimers = [];
  }

  function cascade(): void {
    stopCascade();
    cascadeTimers = Array.from({ length: CASCADE }, (_, index) =>
      window.setTimeout(() => {
        if (!launch()) stopCascade();
      }, index * CASCADE_GAP_MS),
    );
  }

  function stopFever(): void {
    window.clearInterval(feverTimer);
    feverTimer = undefined;
    rng.guided = false;
    golden = false;
    board.setFever(null);
    [message, tone] = ['Fin du Fever Mode.', 'info'];
    render();
  }

  function startFever(isGolden: boolean): void {
    stopCascade();
    window.clearInterval(feverTimer);
    golden = isGolden;
    rng.guided = isGolden;
    board.setFever(state.feverBallsLeft);
    [message, tone] = isGolden
      ? ['FEVERTIME ! Une pluie de billes dorées file vers la poche Platine.', 'win']
      : [`FEVER MODE ! ${FEVER_BALLS} billes gratuites aux gains ×${FEVER_MULTIPLIER}.`, 'win'];
    feverTimer = window.setInterval(
      () => {
        if (state.phase !== 'FEVER') {
          stopFever();
          return;
        }
        const ball = apply({ type: 'FEVER_BALL', playerId: PLAYER });
        if (ball === null) {
          stopFever();
          return;
        }
        track(ball, golden);
        board.setFever(state.phase === 'FEVER' ? state.feverBallsLeft : null);
        render();
      },
      isGolden ? GOLDEN_GAP_MS : FEVER_GAP_MS,
    );
    render();
  }

  function onClick(event: MouseEvent): void {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>('button[data-action]');
    if (button === null || button.disabled) return;
    switch (button.dataset['action']) {
      case 'LAUNCH':
        launch();
        break;
      case 'CASCADE':
        cascade();
        break;
      case 'HALF':
      case 'DOUBLE':
        stake = Math.max(RULES.minStake, Math.min(RULES.maxStake, Math.floor(button.dataset['action'] === 'HALF' ? safeStake() / 2 : safeStake() * 2)));
        stakeEl.value = String(stake);
        break;
      case 'REBUY':
        if (claimDailyRefill('pachinko')) {
          state = expectOk(controller.createSession(PLAYER, state.player.bankroll + DAILY_REFILL));
          [message, tone] = [REFILL_DONE_MESSAGE, 'win'];
        } else {
          [message, tone] = [REFILL_USED_MESSAGE, 'error'];
        }
        render();
        break;
    }
  }

  function onInput(event: Event): void {
    if (event.target === stakeEl) stake = Math.floor(Number(stakeEl.value));
  }

  function onKey(event: KeyboardEvent): void {
    if (event.target instanceof HTMLInputElement || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'Space') {
      event.preventDefault();
      launch();
    }
  }

  function onResize(): void {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => board.resize(), 120);
  }

  setCheatTarget({
    games: ['pachinko'],
    getBalance: () => state.player.bankroll,
    setBalance: (_game, amount) => {
      state = { ...state, player: { ...state.player, bankroll: chips(amount + pending) } };
      render();
      return null;
    },
    refresh: render,
    foresee: () => {
      if (state.phase === 'FEVER') return golden ? 'Toutes les billes dorées filent vers la poche Platine.' : `Fever Mode : encore ${state.feverBallsLeft} billes gratuites.`;
      const pocket = POCKETS[pocketForRoll(rng.peekPocketRoll())];
      return `La prochaine bille tombera dans la poche ${pocket?.label ?? '?'} (×${formatPocketMultiplier(pocket?.multiplier ?? 0)}).`;
    },
    runCode: (code) => {
      if (code !== 'fevertime') return null;
      const feverStake = state.phase === 'FEVER' ? state.feverStake : chips(Math.min(RULES.maxStake, safeStake() || 10));
      state = { ...state, phase: 'FEVER', feverBallsLeft: state.feverBallsLeft + CHEAT_BALLS, feverStake };
      startFever(true);
      const top = POCKETS[TOP_POCKET]?.multiplier ?? 0;
      return `FEVERTIME : ${CHEAT_BALLS} billes dorées gratuites déferlent, toutes guidées vers la poche Platine (×${formatPocketMultiplier(top * FEVER_MULTIPLIER)} en Fever).`;
    },
  });

  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);
  render();

  return () => {
    disposed = true;
    stopCascade();
    window.clearInterval(feverTimer);
    window.clearTimeout(resizeTimer);
    // Les billes gratuites promises sont jouées d'office : quitter en plein Fever ne fait rien perdre.
    while (state.phase === 'FEVER') {
      const ball = apply({ type: 'FEVER_BALL', playerId: PLAYER });
      if (ball === null) break;
      recordResult('pachinko', ball.payout);
    }
    rng.guided = false;
    saveBalance('pachinko', state.player.bankroll);
    board.destroy();
    setCheatTarget(null);
    root.removeEventListener('click', onClick);
    root.removeEventListener('input', onInput);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
  };
}
