import { CryptoRandomSource, chips, playerId, type PlayerId, type RandomSource } from '../src/core/index.js';
import {
  MULTIPLIERS,
  PLINKO_ROWS,
  PlinkoController,
  STANDARD_PLINKO_RULES,
  VOLATILITIES,
  formatMultiplier,
  returnToPlayer,
  type PlinkoCommand,
  type PlinkoState,
  type Volatility,
} from '../src/plinko/index.js';
import { setCheatTarget } from './cheat-console.js';
import { DEFAULT_BALANCE, loadLedger, netOf, recordResult, saveBalance, startingBalance } from './money-ledger.js';
import { PlinkoBoard } from './plinko-board.js';
import { expectOk, formatChips, formatSigned, queryIn, signClass } from './ui.js';

type Tone = 'info' | 'win' | 'loss' | 'error';

const PLAYER: PlayerId = playerId('vous');
const RULES = STANDARD_PLINKO_RULES;
const VOLATILITY_LABELS: Readonly<Record<Volatility, string>> = { LOW: 'Faible', MEDIUM: 'Moyenne', HIGH: 'Élevée' };
const GRAVITY_CODES: ReadonlySet<string> = new Set(['gravity', 'newton']);
const BURST = 10;
const BURST_GAP_MS = 140;
const HISTORY_SIZE = 18;

/**
 * Aléa du Plinko côté interface : lit à l'avance la prochaine bille (voyance) et, avec GRAVITY, force les
 * PLINKO_ROWS tirages d'une bille du même côté pour qu'elle file vers une extrémité.
 */
class PlinkoRandom implements RandomSource {
  readonly #inner: RandomSource;
  readonly #queue: number[] = [];
  #forcedSide = 0;
  #forcedLeft = 0;

  constructor(inner: RandomSource) {
    this.#inner = inner;
  }

  nextInt(maxExclusive: number): number {
    if (maxExclusive === 2 && this.#forcedLeft > 0) {
      this.#forcedLeft -= 1;
      return this.#forcedSide;
    }
    const queued = maxExclusive === 2 ? this.#queue.shift() : undefined;
    return queued ?? this.#inner.nextInt(maxExclusive);
  }

  peekPath(rows: number): readonly number[] {
    while (this.#queue.length < rows) this.#queue.push(this.#inner.nextInt(2));
    return this.#queue.slice(0, rows);
  }

  armGravity(rows: number): void {
    this.#forcedSide = this.#inner.nextInt(2);
    this.#forcedLeft = rows;
  }

  disarmGravity(): void {
    this.#forcedLeft = 0;
  }
}

export function mountPlinko(root: HTMLElement): () => void {
  const rng = new PlinkoRandom(new CryptoRandomSource());
  const controller = new PlinkoController(rng);
  let state: PlinkoState = expectOk(controller.createSession(PLAYER, startingBalance('plinko', RULES.minStake)));
  let stake = 10;
  let message = 'Choisissez votre mise et la volatilité, puis lâchez les billes.';
  let tone: Tone = 'info';
  let gravity = false;
  /** Gains déjà réglés par le moteur mais dont la bille n'a pas encore touché le fond. */
  let pending = 0;
  let history: { multiplier: number; heavy: boolean }[] = [];
  let burstTimers: number[] = [];
  let resizeTimer: number | undefined;

  root.innerHTML = `
    <div class="game pk-game">
      <header class="topbar">
        <a class="back" href="#/">← Lobby</a>
        <h1>Plinko</h1>
        <div class="topbar-stats">
          <div class="bankroll">Bilan <strong data-ledger></strong></div>
          <div class="bankroll">Solde <strong data-bankroll></strong></div>
        </div>
      </header>
      <div class="pk-layout">
        <aside class="pk-controls">
          <label class="pk-label" for="pk-stake">Mise</label>
          <div class="pk-stake">
            <input id="pk-stake" type="number" min="1" step="1" inputmode="numeric" value="${stake}" data-stake>
            <button class="pk-mini" data-action="HALF" aria-label="Diviser la mise par deux">½</button>
            <button class="pk-mini" data-action="DOUBLE" aria-label="Doubler la mise">×2</button>
          </div>
          <span class="pk-label">Volatilité</span>
          <div class="pk-segment" role="radiogroup" aria-label="Volatilité">
            ${VOLATILITIES.map((value) => `<button role="radio" data-action="VOLATILITY" data-volatility="${value}">${VOLATILITY_LABELS[value]}</button>`).join('')}
          </div>
          <p class="pk-rtp" data-rtp></p>
          <button class="btn primary pk-drop" data-action="DROP">Lâcher <kbd>Espace</kbd></button>
          <button class="btn" data-action="BURST">Lâcher ×${BURST}</button>
          <button class="btn ghost" data-action="REBUY" hidden>Recaver ${formatChips(DEFAULT_BALANCE)} jetons</button>
          <p class="message pk-message" data-message aria-live="polite"></p>
        </aside>
        <section class="pk-stage" data-stage>
          <div class="pk-history" data-history aria-label="Derniers multiplicateurs"></div>
          <canvas class="pk-board" data-board aria-label="Pyramide Plinko à 16 rangées"></canvas>
        </section>
      </div>
    </div>`;

  const ledgerEl = queryIn<HTMLElement>(root, '[data-ledger]');
  const bankrollEl = queryIn<HTMLElement>(root, '[data-bankroll]');
  const stakeEl = queryIn<HTMLInputElement>(root, '[data-stake]');
  const rtpEl = queryIn<HTMLElement>(root, '[data-rtp]');
  const messageEl = queryIn<HTMLElement>(root, '[data-message]');
  const historyEl = queryIn<HTMLElement>(root, '[data-history]');
  const stageEl = queryIn<HTMLElement>(root, '[data-stage]');
  const rebuyEl = queryIn<HTMLButtonElement>(root, '[data-action="REBUY"]');
  const board = new PlinkoBoard(queryIn<HTMLCanvasElement>(root, '[data-board]'), MULTIPLIERS[state.volatility]);

  function apply(command: PlinkoCommand): boolean {
    const result = controller.apply(state, command);
    if (!result.ok) {
      [message, tone] = [result.error.message, 'error'];
      return false;
    }
    state = result.value.state;
    return true;
  }

  function render(): void {
    saveBalance('plinko', state.player.bankroll);
    bankrollEl.textContent = formatChips(state.player.bankroll - pending);
    const net = netOf(loadLedger().plinko);
    ledgerEl.textContent = formatSigned(net);
    ledgerEl.className = signClass(net);
    messageEl.textContent = message;
    messageEl.dataset['tone'] = tone;

    const locked = board.inFlight > 0;
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-action="VOLATILITY"]')) {
      const selected = button.dataset['volatility'] === state.volatility;
      button.setAttribute('aria-checked', String(selected));
      button.disabled = locked && !selected;
    }
    const maxMultiplier = Math.max(...MULTIPLIERS[state.volatility]);
    rtpEl.textContent = `Retour théorique ${(returnToPlayer(state.volatility) * 100).toFixed(1).replace('.', ',')} % · jusqu’à ×${formatMultiplier(maxMultiplier)}`;
    rebuyEl.hidden = state.player.bankroll >= RULES.minStake || locked;
    stageEl.classList.toggle('pk-gravity', gravity);
    historyEl.innerHTML = history
      .map((entry) => `<span class="pk-chip ${entry.multiplier >= 100 ? 'is-win' : 'is-loss'} ${entry.heavy ? 'is-heavy' : ''}">×${formatMultiplier(entry.multiplier)}</span>`)
      .join('');
  }

  function dropBall(): boolean {
    const heavy = gravity;
    if (heavy) rng.armGravity(PLINKO_ROWS);
    if (!apply({ type: 'DROP_BALL', playerId: PLAYER, stake: chips(Math.max(0, stake)) })) {
      rng.disarmGravity();
      render();
      return false;
    }
    const [drop] = state.lastDrops;
    if (drop === undefined) return false;
    recordResult('plinko', drop.payout - drop.stake);
    pending += drop.payout;
    board.launch({
      path: drop.path,
      bucket: drop.bucket,
      heavy,
      onLand: () => {
        pending -= drop.payout;
        history = [{ multiplier: drop.multiplier, heavy }, ...history].slice(0, HISTORY_SIZE);
        if (drop.multiplier >= 1_000) [message, tone] = [`×${formatMultiplier(drop.multiplier)} ! ${formatChips(drop.payout)} jetons pour une mise de ${formatChips(drop.stake)}.`, 'win'];
        render();
      },
    });
    [message, tone] = [heavy ? 'Une bille lourde et brûlante file vers le bord…' : 'Bille lâchée !', 'info'];
    render();
    return true;
  }

  function burst(): void {
    burstTimers.forEach((timer) => window.clearTimeout(timer));
    burstTimers = Array.from({ length: BURST }, (_, index) =>
      window.setTimeout(() => {
        if (!dropBall()) {
          burstTimers.forEach((timer) => window.clearTimeout(timer));
          burstTimers = [];
        }
      }, index * BURST_GAP_MS),
    );
  }

  function setStake(value: number): void {
    stake = Math.max(RULES.minStake, Math.min(RULES.maxStake, Math.floor(value)));
    stakeEl.value = String(stake);
  }

  function onClick(event: MouseEvent): void {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>('button[data-action]');
    if (button === null || button.disabled) return;
    switch (button.dataset['action']) {
      case 'HALF':
        setStake(stake / 2);
        break;
      case 'DOUBLE':
        setStake(stake * 2);
        break;
      case 'VOLATILITY': {
        const value = button.dataset['volatility'] as Volatility;
        if (apply({ type: 'SET_VOLATILITY', playerId: PLAYER, volatility: value })) {
          board.setMultipliers(MULTIPLIERS[state.volatility]);
          [message, tone] = [`Volatilité ${VOLATILITY_LABELS[value].toLowerCase()}.`, 'info'];
        }
        render();
        break;
      }
      case 'DROP':
        dropBall();
        break;
      case 'BURST':
        burst();
        break;
      case 'REBUY':
        state = expectOk(controller.createSession(PLAYER, DEFAULT_BALANCE));
        board.setMultipliers(MULTIPLIERS[state.volatility]);
        [message, tone] = [`Nouvelle cave de ${formatChips(DEFAULT_BALANCE)} jetons.`, 'info'];
        render();
        break;
    }
  }

  function onInput(event: Event): void {
    if (event.target === stakeEl) stake = Math.floor(Number(stakeEl.value));
  }

  function onKey(event: KeyboardEvent): void {
    if (event.target instanceof HTMLInputElement || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'Space' || event.key === 'Enter') {
      event.preventDefault();
      dropBall();
    }
  }

  function onResize(): void {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => board.resize(), 120);
  }

  setCheatTarget({
    games: ['plinko'],
    getBalance: () => state.player.bankroll,
    setBalance: (_game, amount) => {
      state = { ...state, player: { ...state.player, bankroll: chips(amount + pending) } };
      render();
      return null;
    },
    refresh: render,
    foresee: () => {
      if (gravity) return 'La gravité est détraquée : la prochaine bille filera vers une extrémité.';
      const path = rng.peekPath(PLINKO_ROWS);
      const bucket = path.reduce((sum, side) => sum + side, 0);
      return `La prochaine bille tombera dans la case ${bucket + 1} sur ${PLINKO_ROWS + 1} (×${formatMultiplier(MULTIPLIERS[state.volatility][bucket] ?? 0)}).`;
    },
    runCode: (code) => {
      if (!GRAVITY_CODES.has(code)) return null;
      gravity = !gravity;
      if (!gravity) {
        render();
        return 'La gravité redevient newtonienne : les billes rebondissent à nouveau au hasard.';
      }
      if (state.volatility !== 'HIGH' && apply({ type: 'SET_VOLATILITY', playerId: PLAYER, volatility: 'HIGH' })) {
        board.setMultipliers(MULTIPLIERS.HIGH);
      }
      [message, tone] = ['Physique cassée : billes lourdes et lumineuses, aspirées vers les ×1000.', 'win'];
      render();
      return `${code.toUpperCase()} : la physique déraille ! Volatilité élevée, chaque bille glisse vers les cases ×1000 des extrémités.`;
    },
  });

  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);
  render();

  return () => {
    burstTimers.forEach((timer) => window.clearTimeout(timer));
    window.clearTimeout(resizeTimer);
    saveBalance('plinko', state.player.bankroll);
    board.destroy();
    setCheatTarget(null);
    root.removeEventListener('click', onClick);
    root.removeEventListener('input', onInput);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
  };
}
