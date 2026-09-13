import { CryptoRandomSource, bigChips, playerId, type PlayerId, type RandomSource } from '../src/core/index.js';
import {
  EUROPEAN_WHEEL_ORDER,
  NO_LIMIT_ROULETTE_RULES,
  RouletteController,
  colorOf,
  describeNumber,
  type BetId,
  type PlacedBet,
  type RouletteCommand,
  type RouletteResultPhase,
  type RouletteSeat,
  type RouletteState,
  type SpinOutcome,
} from '../src/roulette/index.js';
import { setCheatTarget } from './cheat-console.js';
import { DAILY_REFILL, claimDailyRefill, loadLedger, netOf, recordResult, saveBalance, startingBigBalance } from './money-ledger.js';
import { SEGMENT, layoutHtml, selectionOf, wheelSvg } from './roulette-layout.js';
import {
  REFILL_DONE_MESSAGE,
  REFILL_USED_MESSAGE,
  escapeHtml,
  expectOk,
  formatChips,
  formatSigned,
  queryIn,
  refillButtonHtml,
  signClass,
} from './ui.js';

type Tone = 'info' | 'win' | 'loss' | 'error';

const PLAYER: PlayerId = playerId('vous');
const SEAT = 0;
/** Aucune limite : un jeton minimum, puis le solde est le seul plafond, en entiers de précision arbitraire. */
const RULES = NO_LIMIT_ROULETTE_RULES;
const CHIP_VALUES = [1n, 5n, 25n, 100n, 500n] as const;
const SPIN_MS = 5_000;
const COLOR_LABELS = { GREEN: 'vert', RED: 'rouge', BLACK: 'noir' } as const;
const COMPACT_UNITS = ['', 'k', 'M', 'Md', 'Bn', 'Bd', 'Tn'] as const;

/** Source d'aléa dont on peut lire le prochain tirage : ne sert qu'au code de triche « voyance ». */
class ForeseeableRandom implements RandomSource {
  readonly #inner: RandomSource;
  #peeked: { readonly max: number; readonly value: number } | null = null;

  constructor(inner: RandomSource) {
    this.#inner = inner;
  }

  nextInt(maxExclusive: number): number {
    const peeked = this.#peeked;
    this.#peeked = null;
    return peeked !== null && peeked.max === maxExclusive ? peeked.value : this.#inner.nextInt(maxExclusive);
  }

  peek(maxExclusive: number): number {
    if (this.#peeked === null || this.#peeked.max !== maxExclusive) {
      this.#peeked = { max: maxExclusive, value: this.#inner.nextInt(maxExclusive) };
    }
    return this.#peeked.value;
  }
}

function outcomeText(outcome: SpinOutcome): string {
  if (outcome.color === 'GREEN') return '0 vert';
  const parity = outcome.parity === 'EVEN' ? 'pair' : 'impair';
  const range = outcome.range === 'LOW' ? 'manque' : 'passe';
  return `${outcome.number} ${COLOR_LABELS[outcome.color]} · ${parity} · ${range}`;
}

/** 1 500 → 1.5k, 557 256 278 016 000 → 557Bd : le jeton posé sur le tapis reste lisible quel que soit le montant. */
function compactChips(amount: bigint): string {
  let scaled = amount;
  let remainder = 0n;
  let unit = 0;
  while (scaled >= 1_000n && unit < COMPACT_UNITS.length - 1) {
    remainder = scaled % 1_000n;
    scaled /= 1_000n;
    unit += 1;
  }
  if (scaled >= 1_000n) return Number(amount).toExponential(1).replace('e+', 'e');
  const decimal = scaled < 100n && remainder >= 100n ? `.${remainder / 100n}` : '';
  return `${scaled}${decimal}${COMPACT_UNITS[unit] ?? ''}`;
}

const totalOf = (bets: readonly PlacedBet[]): bigint => bets.reduce<bigint>((sum, bet) => sum + bet.amount, 0n);

export function mountRoulette(root: HTMLElement): () => void {
  const rng = new ForeseeableRandom(new CryptoRandomSource());
  const controller = new RouletteController(rng);
  const { catalog } = controller;
  const spinMs = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 400 : SPIN_MS;

  /** Un joueur ruiné reste debout (le moteur refuse une cave nulle) : seule la recharge du jour lui est proposée. */
  function newTable(buyIn: bigint): RouletteState {
    const table = expectOk(controller.createTable(RULES));
    if (buyIn === 0n) return table;
    return expectOk(
      controller.apply(table, { type: 'SIT_DOWN', playerId: PLAYER, seatIndex: SEAT, displayName: 'Vous', buyIn: bigChips(buyIn) }),
    ).state;
  }

  let state = newTable(startingBigBalance('roulette'));
  let message =
    (state.seats[SEAT] ?? null) === null ? "Vous n'avez plus de jetons." : 'Faites vos jeux : choisissez un jeton, puis cliquez sur le tapis.';
  let tone: Tone = 'info';
  /** Valeur du jeton sélectionné, ou tout le solde avec le jeton All-in. */
  let chipValue: bigint | 'ALL_IN' = 5n;
  let revealing = false;
  let rotation = 0;
  /** Mises du dernier tour, pour « Rejouer la mise ». */
  let lastBets: readonly PlacedBet[] = [];
  let timer: number | undefined;

  root.innerHTML = `
    <div class="game">
      <header class="topbar">
        <a class="back" href="#/">← Lobby</a>
        <h1>Roulette</h1>
        <div class="topbar-stats">
          <div class="bankroll">Bilan <strong data-ledger></strong></div>
          <div class="bankroll">Solde <strong data-bankroll></strong></div>
        </div>
      </header>
      <section class="felt rl-felt">
        <div class="rl-head">
          <div class="rl-wheel" role="img" aria-label="Cylindre de roulette européenne">
            <div class="rl-rotor" data-rotor>${wheelSvg()}</div>
            <div class="rl-pointer" aria-hidden="true"></div>
            <div class="rl-hub" data-hub></div>
          </div>
          <div class="rl-info">
            <p class="rules-strip">Roulette européenne · un seul zéro · plein 35:1 · chances simples 1:1 · aucune limite de mise</p>
            <p class="message" data-message aria-live="polite"></p>
            <div class="rl-history" data-history></div>
            <ul class="rl-results" data-results></ul>
          </div>
        </div>
        <div class="rl-layout-scroll"><div class="rl-layout" data-layout>${layoutHtml(catalog)}</div></div>
        <p class="rl-hint">Clic : poser un jeton · clic droit : retirer une position · lignes et coins pour jouer à cheval · jeton All-in : tout votre solde sur une position, sans plafond</p>
      </section>
      <nav class="controls" data-controls></nav>
    </div>`;

  const ledgerEl = queryIn<HTMLElement>(root, '[data-ledger]');
  const bankrollEl = queryIn<HTMLElement>(root, '[data-bankroll]');
  const rotorEl = queryIn<HTMLElement>(root, '[data-rotor]');
  const hubEl = queryIn<HTMLElement>(root, '[data-hub]');
  const messageEl = queryIn<HTMLElement>(root, '[data-message]');
  const historyEl = queryIn<HTMLElement>(root, '[data-history]');
  const resultsEl = queryIn<HTMLElement>(root, '[data-results]');
  const layoutEl = queryIn<HTMLElement>(root, '[data-layout]');
  const controlsEl = queryIn<HTMLElement>(root, '[data-controls]');

  const seatOf = (): RouletteSeat | null => state.seats[SEAT] ?? null;
  const currentResult = (): RouletteResultPhase | null => (state.phase === 'RESULT' ? state : null);
  const canBet = (): boolean => state.phase === 'BETTING' && !revealing;

  function apply(command: RouletteCommand): boolean {
    const result = controller.apply(state, command);
    if (!result.ok) {
      message = result.error.message;
      tone = 'error';
      return false;
    }
    state = result.value.state;
    return true;
  }

  function placeChip(betId: string): void {
    const bet = catalog.get(betId as BetId);
    if (bet === undefined || !canBet()) return;
    const allIn = chipValue === 'ALL_IN';
    const amount = chipValue === 'ALL_IN' ? (seatOf()?.bankroll ?? 0n) : chipValue;
    if (amount === 0n) {
      [message, tone] = ['Plus aucun jeton à miser : lancez la bille ou effacez le tapis.', 'error'];
    } else if (apply({ type: 'PLACE_BET', playerId: PLAYER, bet: selectionOf(bet), amount: bigChips(amount) })) {
      [message, tone] = [allIn ? `All-in ! ${formatChips(amount)} jetons sur ${bet.label}` : `${formatChips(amount)} sur ${bet.label}`, 'info'];
    }
    render();
  }

  function removePosition(betId: string): void {
    const bet = catalog.get(betId as BetId);
    if (bet === undefined || !canBet() || !seatOf()?.bets.some((placed) => placed.betId === bet.id)) return;
    if (apply({ type: 'REMOVE_BET', playerId: PLAYER, betId: bet.id })) {
      message = `Jetons retirés de ${bet.label}.`;
      tone = 'info';
    }
    render();
  }

  function replayBets(): void {
    for (const placed of lastBets) {
      const bet = catalog.get(placed.betId);
      if (bet === undefined) continue;
      if (!apply({ type: 'PLACE_BET', playerId: PLAYER, bet: selectionOf(bet), amount: placed.amount })) return;
    }
    message = 'Mises du tour précédent replacées.';
    tone = 'info';
  }

  /** Tourne toujours vers l'avant, d'au moins 6 tours, pour amener la case gagnante sous le repère. */
  function spinWheel(pocketIndex: number): void {
    const target = (360 - pocketIndex * SEGMENT) % 360;
    rotation = Math.ceil(rotation / 360) * 360 + 360 * 6 + target;
    rotorEl.style.transform = `rotate(${rotation}deg)`;
  }

  function launch(): void {
    const seat = seatOf();
    if (!canBet() || seat === null || seat.bets.length === 0) return;
    lastBets = seat.bets;
    if (!apply({ type: 'CLOSE_BETS' }) || !apply({ type: 'SPIN' })) {
      render();
      return;
    }
    const result = currentResult();
    if (result === null) return;
    // Le tour est réglé dès le lancer : quitter pendant l'animation ne change rien au bilan.
    const settlement = result.settlements.find((entry) => entry.seatIndex === SEAT);
    if (settlement !== undefined) recordResult('roulette', settlement.net);
    revealing = true;
    message = 'Rien ne va plus…';
    tone = 'info';
    spinWheel(result.spin.pocketIndex);
    render();
    timer = window.setTimeout(reveal, spinMs);
  }

  function reveal(): void {
    revealing = false;
    const result = currentResult();
    if (result === null) return;
    const { outcome } = result;
    const settlement = result.settlements.find((entry) => entry.seatIndex === SEAT);
    const net = settlement?.net ?? 0n;
    const announce = outcomeText(outcome);
    if (net > 0n) [message, tone] = [`${announce}. Vous gagnez ${formatChips(net)} jetons !`, 'win'];
    else if (net < 0n) [message, tone] = [`${announce}. Vous perdez ${formatChips(-net)} jetons.`, 'loss'];
    else [message, tone] = [`${announce}. Vous récupérez votre mise.`, 'info'];
    const lostOutside = settlement?.bets.some((bet) => catalog.get(bet.betId)?.family === 'OUTSIDE') ?? false;
    if (outcome.number === 0 && lostOutside) message += ' Le zéro fait perdre toutes les mises externes.';
    render();
  }

  function nextRound(replay: boolean): void {
    if (revealing || currentResult() === null) return;
    apply({ type: 'NEXT_ROUND' });
    [message, tone] = ['Faites vos jeux.', 'info'];
    if (replay) replayBets();
    render();
  }

  function renderChips(bets: readonly PlacedBet[], outcome: SpinOutcome | null): void {
    const amounts = new Map<string, bigint>(bets.map((bet) => [bet.betId, bet.amount]));
    const hitId = outcome === null ? null : expectOk(catalog.resolve({ kind: 'STRAIGHT', numbers: [outcome.number] })).id;
    for (const element of layoutEl.querySelectorAll<HTMLElement>('[data-bet]')) {
      const betId = element.dataset['bet'] ?? '';
      const amount = amounts.get(betId) ?? 0n;
      const covered = outcome !== null && (catalog.get(betId as BetId)?.covers.includes(outcome.number) ?? false);
      element.classList.toggle('has-chip', amount > 0n);
      element.classList.toggle('rl-won', amount > 0n && covered);
      element.classList.toggle('rl-lost', amount > 0n && outcome !== null && !covered);
      element.classList.toggle('rl-hit', betId === hitId);
      const chip = element.querySelector('.rl-chip');
      if (chip !== null) chip.textContent = amount > 0n ? compactChips(amount) : '';
    }
  }

  function renderControls(seat: RouletteSeat | null): string {
    const button = (action: string, label: string, enabled = true, variant = ''): string =>
      `<button class="btn ${variant}" data-action="${action}" ${enabled ? '' : 'disabled'}>${label}</button>`;
    if (seat === null) return refillButtonHtml('roulette');
    if (revealing) return '<p class="waiting">La bille tourne…</p>';
    if (currentResult() !== null) {
      const affordable = lastBets.length > 0 && totalOf(lastBets) <= seat.bankroll;
      return button('REPLAY', 'Rejouer la mise', affordable, 'ghost') + button('NEXT_ROUND', 'Nouveau tour <kbd>↵</kbd>', true, 'primary');
    }

    const staked = totalOf(seat.bets);
    if (seat.bankroll + staked < RULES.minBet) return refillButtonHtml('roulette');
    const rack = CHIP_VALUES.map(
      (value) =>
        `<button class="chip chip-${value} ${value === chipValue ? 'selected' : ''}" data-action="CHIP" data-value="${value}" ` +
        `aria-pressed="${value === chipValue}" aria-label="Jeton de ${value}">${value}</button>`,
    ).join('');
    const allInSelected = chipValue === 'ALL_IN';
    const allInChip =
      `<button class="chip chip-all-in ${allInSelected ? 'selected' : ''}" data-action="CHIP" data-value="ALL_IN" ` +
      `aria-pressed="${allInSelected}" aria-label="All-in : miser tout le solde sur une position" title="Tout votre solde sur la prochaine position cliquée">All-in</button>`;
    const canReplay = staked === 0n && lastBets.length > 0 && totalOf(lastBets) <= seat.bankroll;
    return `<div class="chip-rack">${rack}${allInChip}</div>
      <span class="rl-total">Mise totale <strong>${formatChips(staked)}</strong></span>
      ${button('CLEAR_BETS', 'Effacer', staked > 0n, 'ghost')}
      ${button('REPLAY_BETTING', 'Rejouer la mise', canReplay, 'ghost')}
      ${button('SPIN', 'Lancer la bille <kbd>↵</kbd>', staked > 0n, 'primary')}`;
  }

  function render(): void {
    const seat = seatOf();
    const result = currentResult();
    const settlement = result?.settlements.find((entry) => entry.seatIndex === SEAT) ?? null;
    const revealed = result !== null && !revealing;

    // Pendant l'animation, le solde affiché reste celui d'avant le paiement.
    const shownBankroll = revealing && settlement !== null ? settlement.bankrollAfter - settlement.totalReturned : (seat?.bankroll ?? 0n);
    bankrollEl.textContent = formatChips(shownBankroll);
    if (seat !== null) saveBalance('roulette', seat.bankroll + totalOf(seat.bets));
    const net = netOf(loadLedger().roulette);
    ledgerEl.textContent = formatSigned(net);
    ledgerEl.className = signClass(net);

    messageEl.textContent = message;
    messageEl.dataset['tone'] = tone;

    const history = revealing ? state.history.slice(1) : state.history;
    historyEl.innerHTML =
      history.map((n) => `<span class="rl-ball rl-${colorOf(n).toLowerCase()}">${n}</span>`).join('') ||
      '<span class="rl-empty">Aucun numéro sorti pour l’instant</span>';

    hubEl.textContent = revealed ? String(result.outcome.number) : '';
    hubEl.className = `rl-hub${revealed ? ` rl-${result.outcome.color.toLowerCase()}` : ''}`;

    resultsEl.innerHTML =
      revealed && settlement !== null
        ? settlement.bets
            .map(
              (bet) =>
                `<li><span>${escapeHtml(bet.label)} · mise ${formatChips(bet.stake)}</span>` +
                `<strong class="${signClass(bet.net)}">${formatSigned(bet.net)}</strong></li>`,
            )
            .join('')
        : '';

    const shownBets = state.phase === 'BETTING' ? (seat?.bets ?? []) : (settlement?.bets.map((bet) => ({ betId: bet.betId, amount: bet.stake })) ?? []);
    renderChips(shownBets, revealed ? result.outcome : null);
    layoutEl.classList.toggle('locked', !canBet());
    controlsEl.innerHTML = renderControls(seat);
  }

  function onClick(event: MouseEvent): void {
    if (!(event.target instanceof Element)) return;
    const spot = event.target.closest<HTMLElement>('[data-bet]');
    if (spot !== null && layoutEl.contains(spot)) {
      placeChip(spot.dataset['bet'] ?? '');
      return;
    }
    const button = event.target.closest<HTMLButtonElement>('button[data-action]');
    if (button === null || button.disabled) return;
    switch (button.dataset['action']) {
      case 'CHIP': {
        const value = button.dataset['value'] ?? '';
        chipValue = value === 'ALL_IN' ? 'ALL_IN' : BigInt(/^\d+$/.test(value) ? value : '5');
        render();
        break;
      }
      case 'CLEAR_BETS':
        if (apply({ type: 'CLEAR_BETS', playerId: PLAYER })) [message, tone] = ['Tapis effacé.', 'info'];
        render();
        break;
      case 'REPLAY_BETTING':
        replayBets();
        render();
        break;
      case 'SPIN':
        launch();
        break;
      case 'NEXT_ROUND':
        nextRound(false);
        break;
      case 'REPLAY':
        nextRound(true);
        break;
      case 'REBUY': {
        const seat = seatOf();
        if (claimDailyRefill('roulette')) {
          state = newTable((seat === null ? 0n : seat.bankroll + totalOf(seat.bets)) + BigInt(DAILY_REFILL));
          lastBets = [];
          [message, tone] = [REFILL_DONE_MESSAGE, 'win'];
        } else {
          [message, tone] = [REFILL_USED_MESSAGE, 'error'];
        }
        render();
        break;
      }
    }
  }

  function onContextMenu(event: MouseEvent): void {
    if (!(event.target instanceof Element)) return;
    const spot = event.target.closest<HTMLElement>('[data-bet]');
    if (spot === null || !layoutEl.contains(spot)) return;
    event.preventDefault();
    removePosition(spot.dataset['bet'] ?? '');
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    const button = controlsEl.querySelector<HTMLButtonElement>('[data-action="SPIN"], [data-action="NEXT_ROUND"]');
    if (button !== null && !button.disabled) {
      event.preventDefault();
      button.click();
    }
  }

  setCheatTarget({
    games: ['roulette'],
    getBalance: () => seatOf()?.bankroll ?? 0n,
    setBalance: (_game, amount) => {
      const seat = seatOf();
      if (seat === null) {
        // Joueur ruiné, donc debout : le nouveau solde le rassoit.
        state = newTable(amount);
        render();
        return null;
      }
      if (revealing) return 'La bille tourne : attendez le résultat.';
      state = { ...state, seats: state.seats.map((current, index) => (index === SEAT ? { ...seat, bankroll: bigChips(amount) } : current)) };
      render();
      return null;
    },
    refresh: render,
    foresee: () => {
      if (revealing) return 'La bille tourne déjà : le résultat est scellé.';
      const number = EUROPEAN_WHEEL_ORDER[rng.peek(EUROPEAN_WHEEL_ORDER.length)];
      return number === undefined ? 'La boule de cristal est trouble.' : `Prochain numéro : ${outcomeText(describeNumber(number))}`;
    },
  });

  root.addEventListener('click', onClick);
  root.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKey);
  render();

  return () => {
    window.clearTimeout(timer);
    setCheatTarget(null);
    root.removeEventListener('click', onClick);
    root.removeEventListener('contextmenu', onContextMenu);
    window.removeEventListener('keydown', onKey);
  };
}
