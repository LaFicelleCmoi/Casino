import { CryptoRandomSource, chips, playerId, type PlayerId, type SeatIndex } from '../src/core/index.js';
import {
  HoldemController,
  STANDARD_HOLDEM_RULES,
  isHandInProgress,
  type HandCategory,
  type HoldemCommand,
  type HoldemEvent,
  type HoldemState,
  type HoldemTableView,
  type PokerBettingActionType,
  type PokerSeatView,
  type Street,
} from '../src/holdem/index.js';
import { chooseBotAction } from './holdem-bot.js';
import { loadLedger, netOf, recordResult } from './money-ledger.js';
import { DealAnimator, cardText, escapeHtml, expectOk, formatChips, formatSigned, queryIn, signClass } from './ui.js';

const HUMAN: PlayerId = playerId('vous');
const HUMAN_SEAT = 0;
const BUY_IN = 1_000;
const RULES = { ...STANDARD_HOLDEM_RULES, seatCount: 6 };
const NAMES = ['Vous', 'Léa', 'Hugo', 'Nora', 'Malik', 'Inès'] as const;
const BOT_DELAY_MS = 850;

const CATEGORY_LABELS: Record<HandCategory, string> = {
  HIGH_CARD: 'Hauteur',
  ONE_PAIR: 'Paire',
  TWO_PAIR: 'Double paire',
  THREE_OF_A_KIND: 'Brelan',
  STRAIGHT: 'Quinte',
  FLUSH: 'Couleur',
  FULL_HOUSE: 'Full',
  FOUR_OF_A_KIND: 'Carré',
  STRAIGHT_FLUSH: 'Quinte flush',
};

const ACTION_LOG: Record<PokerBettingActionType, string> = {
  FOLD: 'se couche',
  CHECK: 'checke',
  CALL: 'suit',
  BET: 'mise',
  RAISE: 'relance à',
  ALL_IN: 'fait tapis à',
};

const ACTION_BADGES: Record<PokerBettingActionType, string> = {
  FOLD: 'Couché',
  CHECK: 'Check',
  CALL: 'Suit',
  BET: 'Mise',
  RAISE: 'Relance',
  ALL_IN: 'Tapis',
};

const STREET_LABELS: Record<Exclude<Street, 'PREFLOP'>, string> = { FLOP: 'Flop', TURN: 'Turn', RIVER: 'River' };

function idFor(seatIndex: SeatIndex): PlayerId {
  return seatIndex === HUMAN_SEAT ? HUMAN : playerId(`bot-${seatIndex}`);
}

function sitDown(engine: HoldemController, state: HoldemState, seatIndex: SeatIndex): HoldemState {
  return expectOk(
    engine.apply(state, {
      type: 'SIT_DOWN',
      playerId: idFor(seatIndex),
      seatIndex,
      displayName: NAMES[seatIndex] ?? `Joueur ${seatIndex + 1}`,
      buyIn: chips(BUY_IN),
    }),
  ).state;
}

function newTable(engine: HoldemController): HoldemState {
  let state: HoldemState = expectOk(engine.createTable(RULES));
  for (let seatIndex = 0; seatIndex < NAMES.length; seatIndex += 1) state = sitDown(engine, state, seatIndex);
  return state;
}

function potTotal(view: HoldemTableView): number {
  return (
    view.pots.reduce((sum, pot) => sum + pot.amount, 0) + view.seats.reduce((sum, seat) => sum + (seat?.streetBet ?? 0), 0)
  );
}

export function mountHoldem(root: HTMLElement): () => void {
  const rng = new CryptoRandomSource();
  const engine = new HoldemController(rng);
  const animator = new DealAnimator();
  let state = newTable(engine);
  let log: string[] = [];
  let notice = '';
  let raiseTo = 0;
  let timer: number | undefined;
  /** Tapis du joueur avant la main en cours ; null hors main. */
  let handStartStack: number | null = null;

  root.innerHTML = `
    <div class="game">
      <header class="topbar">
        <a class="back" href="#/">← Lobby</a>
        <h1>Texas Hold'em</h1>
        <div class="topbar-stats">
          <div class="bankroll">Bilan <strong data-ledger></strong></div>
          <div class="bankroll">Tapis <strong data-stack></strong></div>
        </div>
      </header>
      <div class="holdem-layout">
        <section class="felt poker-felt">
          <div class="poker-table">
            <div class="board-zone">
              <div class="pot" data-pot></div>
              <div class="card-row board" data-board></div>
              <p class="message" data-message aria-live="polite"></p>
            </div>
            <div data-seats></div>
          </div>
        </section>
        <aside class="side-panel">
          <h2>Déroulement</h2>
          <ol class="log" data-log></ol>
        </aside>
      </div>
      <nav class="controls" data-controls></nav>
    </div>`;

  const stackEl = queryIn<HTMLElement>(root, '[data-stack]');
  const ledgerEl = queryIn<HTMLElement>(root, '[data-ledger]');
  const potEl = queryIn<HTMLElement>(root, '[data-pot]');
  const boardEl = queryIn<HTMLElement>(root, '[data-board]');
  const messageEl = queryIn<HTMLElement>(root, '[data-message]');
  const seatsEl = queryIn<HTMLElement>(root, '[data-seats]');
  const logEl = queryIn<HTMLElement>(root, '[data-log]');
  const controlsEl = queryIn<HTMLElement>(root, '[data-controls]');

  const humanStack = (): number => state.seats[HUMAN_SEAT]?.stack ?? 0;

  const nameOf = (seatIndex: SeatIndex): string =>
    state.seats[seatIndex]?.player.displayName ?? `Siège ${seatIndex + 1}`;

  function pushLog(line: string): void {
    log = [...log, line].slice(-60);
  }

  function describeEvent(event: HoldemEvent): string | null {
    switch (event.type) {
      case 'HAND_STARTED':
        return `— Main n°${event.handNumber} · bouton : ${nameOf(event.buttonSeat)}`;
      case 'FORCED_BET_POSTED':
        if (event.kind === 'ANTE') return null;
        return `${nameOf(event.seatIndex)} poste la ${event.kind === 'SMALL_BLIND' ? 'petite' : 'grosse'} blinde (${formatChips(event.amount)})`;
      case 'PLAYER_ACTED': {
        const amount = event.action === 'CALL' ? event.amount : event.streetBet;
        const suffix = event.action === 'FOLD' || event.action === 'CHECK' ? '' : ` ${formatChips(amount)}`;
        return `${nameOf(event.seatIndex)} ${ACTION_LOG[event.action]}${suffix}`;
      }
      case 'STREET_DEALT':
        return `${STREET_LABELS[event.street]} : ${event.cards.map(cardText).join(' ')}`;
      case 'UNCALLED_BET_RETURNED':
        return `${formatChips(event.amount)} non suivis rendus à ${nameOf(event.seatIndex)}`;
      case 'POT_AWARDED': {
        const hand = event.award.winningHand;
        const potName = event.award.potIndex === 0 ? 'le pot principal' : `le side pot n°${event.award.potIndex}`;
        return event.award.shares
          .map((share) => `${nameOf(share.seatIndex)} remporte ${formatChips(share.amount)} (${potName}${hand ? `, ${CATEGORY_LABELS[hand.category]}` : ''})`)
          .join(' · ');
      }
      default:
        return null;
    }
  }

  function potText(view: HoldemTableView): string {
    if (view.outcome !== null) {
      const won = new Map<SeatIndex, number>();
      for (const award of view.outcome.awards) {
        for (const share of award.shares) won.set(share.seatIndex, (won.get(share.seatIndex) ?? 0) + share.amount);
      }
      return [...won].map(([seat, amount]) => `${nameOf(seat)} +${formatChips(amount)}`).join(' · ');
    }
    return view.phase === 'WAITING' ? '' : `Pot ${formatChips(potTotal(view))}`;
  }

  function turnText(view: HoldemTableView): string {
    if (view.outcome !== null) {
      const hand = view.outcome.awards[0]?.winningHand;
      return hand ? `Abattage : ${CATEGORY_LABELS[hand.category]} gagnant.` : 'Tout le monde s’est couché.';
    }
    if (view.toAct === null) return '';
    return view.toAct === HUMAN_SEAT ? 'À vous de parler.' : `${nameOf(view.toAct)} réfléchit…`;
  }

  function renderSeat(view: HoldemTableView, seat: PokerSeatView | null, index: number): string {
    if (seat === null) return '';
    const { outcome } = view;
    const winners = new Set(outcome?.awards.flatMap((award) => award.shares.map((share) => share.seatIndex)) ?? []);
    const shown = outcome?.kind === 'SHOWDOWN' ? outcome.showdown.find((entry) => entry.seatIndex === index) : undefined;

    const cards =
      seat.holeCards === null
        ? ''
        : seat.holeCards
            .map((card, i) =>
              animator.card(`h${view.handNumber}-${index}-${i}-${card.faceUp ? 'up' : 'down'}`, card.faceUp ? card.card : null, true),
            )
            .join('');

    let badge = '';
    if (shown !== undefined) badge = CATEGORY_LABELS[shown.hand.category];
    else if (seat.status === 'SITTING_OUT') badge = seat.stack === 0 ? 'Éliminé' : 'Absent';
    else if (seat.status === 'ALL_IN') badge = 'Tapis';
    else if (seat.lastAction !== null && view.phase !== 'HAND_COMPLETE') badge = ACTION_BADGES[seat.lastAction];

    const classes = [
      'seat',
      `seat-${index}`,
      view.toAct === index ? 'acting' : '',
      seat.status === 'FOLDED' ? 'folded' : '',
      winners.has(index) ? 'winner' : '',
      index === HUMAN_SEAT ? 'hero' : '',
    ]
      .filter(Boolean)
      .join(' ');
    const bet =
      seat.streetBet > 0 && view.phase !== 'HAND_COMPLETE' ? `<span class="bet-chip">${formatChips(seat.streetBet)}</span>` : '';

    return `
      <div class="${classes}">
        <div class="seat-cards">${cards}</div>
        <div class="seat-plate">
          ${view.buttonSeat === index ? '<span class="dealer-button" title="Bouton">D</span>' : ''}
          <span class="seat-name">${escapeHtml(seat.player.displayName)}</span>
          <span class="seat-stack">${formatChips(seat.stack)}</span>
          ${badge ? `<span class="seat-badge">${badge}</span>` : ''}
        </div>
        ${bet}
      </div>`;
  }

  function renderControls(view: HoldemTableView): string {
    const button = (action: string, label: string, variant = '', data = ''): string =>
      `<button class="btn ${variant}" data-action="${action}" ${data}>${label}</button>`;

    if (view.phase === 'WAITING' || view.phase === 'HAND_COMPLETE') {
      const broke = (view.seats[HUMAN_SEAT]?.stack ?? 0) === 0;
      return broke
        ? `<p class="waiting">Vous n'avez plus de jetons.</p>${button('RESET', 'Nouvelle table', 'primary')}`
        : button('NEXT_HAND', 'Main suivante <kbd>↵</kbd>', 'primary');
    }

    const legal = view.legalActions;
    if (legal === null) {
      return `<p class="waiting">${view.toAct === null ? '' : `${escapeHtml(nameOf(view.toAct))} réfléchit…`}</p>`;
    }

    const parts = [button('FOLD', 'Se coucher <kbd>F</kbd>', 'ghost')];
    parts.push(
      legal.canCheck
        ? button('CHECK', 'Checker <kbd>C</kbd>')
        : button('CALL', `Suivre ${formatChips(legal.callAmount ?? 0)} <kbd>C</kbd>`, 'primary'),
    );

    const range = legal.raise ?? legal.bet;
    if (range !== null) {
      if (raiseTo < range.min || raiseTo > range.max) raiseTo = range.min;
      const pot = potTotal(view);
      const preset = (label: string, fraction: number): string => {
        const value = Math.min(range.max, Math.max(range.min, range.min + Math.round(pot * fraction)));
        return button('PRESET', label, 'ghost', `data-value="${value}"`);
      };
      const isRaise = legal.raise !== null;
      parts.push(`
        <div class="raise-box">
          <input type="range" data-raise min="${range.min}" max="${range.max}" step="1" value="${raiseTo}" aria-label="Montant de la mise">
          <div class="presets">${preset('½ pot', 0.5)}${preset('Pot', 1)}</div>
          ${button(isRaise ? 'RAISE' : 'BET', `${isRaise ? 'Relancer à' : 'Miser'} <strong data-raise-label>${formatChips(raiseTo)}</strong>`, 'primary')}
        </div>`);
    }
    if (legal.allInAmount !== null) parts.push(button('ALL_IN', `Tapis ${formatChips(legal.allInAmount)}`, 'danger'));
    return parts.join('');
  }

  function render(): void {
    const view = engine.project(state, HUMAN);
    animator.beginFrame();

    stackEl.textContent = formatChips(view.seats[HUMAN_SEAT]?.stack ?? 0);
    const net = netOf(loadLedger().holdem);
    ledgerEl.textContent = formatSigned(net);
    ledgerEl.className = signClass(net);
    boardEl.innerHTML = Array.from({ length: 5 }, (_, i) => {
      const card = view.board[i];
      return card === undefined ? '<div class="card-slot"></div>' : animator.card(`b${view.handNumber}-${i}`, card);
    }).join('');
    potEl.textContent = potText(view);
    messageEl.textContent = notice || turnText(view);
    messageEl.dataset['tone'] = notice ? 'error' : 'info';
    seatsEl.innerHTML = view.seats.map((seat, index) => renderSeat(view, seat, index)).join('');
    controlsEl.innerHTML = renderControls(view);
    logEl.innerHTML = log.map((line) => `<li>${escapeHtml(line)}</li>`).join('');
    logEl.scrollTop = logEl.scrollHeight;
  }

  function scheduleBot(): void {
    window.clearTimeout(timer);
    if (!isHandInProgress(state) || state.seats[state.betting.toAct]?.player.id === HUMAN) return;
    timer = window.setTimeout(() => {
      if (!isHandInProgress(state)) return;
      const actor = state.seats[state.betting.toAct];
      if (actor === null || actor === undefined || actor.player.id === HUMAN) return;
      const legal = engine.legalActions(state, actor.player.id);
      if (legal !== null) act(chooseBotAction(state, actor, legal, rng));
    }, BOT_DELAY_MS);
  }

  function act(command: HoldemCommand): void {
    const stackBefore = humanStack();
    const result = engine.apply(state, command);
    if (!result.ok) {
      notice = result.error.message;
      render();
      return;
    }
    state = result.value.state;
    if (command.type === 'START_HAND') handStartStack = state.phase !== 'WAITING' && stackBefore > 0 ? stackBefore : null;
    if (state.phase === 'HAND_COMPLETE' && handStartStack !== null) {
      recordResult('holdem', humanStack() - handStartStack);
      handStartStack = null;
    }
    notice = '';
    for (const event of result.value.events) {
      const line = describeEvent(event);
      if (line !== null) pushLog(line);
    }
    render();
    scheduleBot();
  }

  function startHand(): void {
    // Recave automatique des bots éliminés, pour garder une table pleine.
    for (const seat of state.seats) {
      if (seat !== null && seat.seatIndex !== HUMAN_SEAT && seat.stack === 0) {
        state = expectOk(engine.apply(state, { type: 'LEAVE_SEAT', playerId: seat.player.id })).state;
        state = sitDown(engine, state, seat.seatIndex);
        pushLog(`${seat.player.displayName} recave ${formatChips(BUY_IN)} jetons.`);
      }
    }
    act({ type: 'START_HAND' });
  }

  function onClick(event: MouseEvent): void {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>('button[data-action]');
    if (button === null || button.disabled) return;

    const action = button.dataset['action'];
    switch (action) {
      case 'NEXT_HAND':
        startHand();
        break;
      case 'RESET':
        window.clearTimeout(timer);
        state = newTable(engine);
        log = [];
        startHand();
        break;
      case 'FOLD':
      case 'CHECK':
      case 'CALL':
      case 'ALL_IN':
        act({ type: action, playerId: HUMAN });
        break;
      case 'BET':
        act({ type: 'BET', playerId: HUMAN, amount: chips(raiseTo) });
        break;
      case 'RAISE':
        act({ type: 'RAISE', playerId: HUMAN, raiseTo: chips(raiseTo) });
        break;
      case 'PRESET':
        raiseTo = Number(button.dataset['value']);
        render();
        break;
    }
  }

  function onInput(event: Event): void {
    if (!(event.target instanceof HTMLInputElement) || !event.target.matches('[data-raise]')) return;
    raiseTo = Number(event.target.value);
    const label = root.querySelector('[data-raise-label]');
    if (label !== null) label.textContent = formatChips(raiseTo);
  }

  function onKey(event: KeyboardEvent): void {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.target instanceof HTMLInputElement) return;
    const shortcuts: Readonly<Record<string, string>> = {
      ENTER: '[data-action="NEXT_HAND"]',
      F: '[data-action="FOLD"]',
      C: '[data-action="CHECK"], [data-action="CALL"]',
    };
    const selector = shortcuts[event.key.toUpperCase()];
    const button = selector === undefined ? null : controlsEl.querySelector<HTMLButtonElement>(selector);
    if (button !== null && !button.disabled) {
      event.preventDefault();
      button.click();
    }
  }

  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  window.addEventListener('keydown', onKey);
  render();
  startHand();

  return () => {
    window.clearTimeout(timer);
    // Quitter en pleine main abandonne les jetons déjà engagés.
    if (handStartStack !== null && isHandInProgress(state)) recordResult('holdem', humanStack() - handStartStack);
    root.removeEventListener('click', onClick);
    root.removeEventListener('input', onInput);
    window.removeEventListener('keydown', onKey);
  };
}
