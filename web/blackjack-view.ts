import { CryptoRandomSource, chips, playerId, type PlayerId } from '../src/core/index.js';
import {
  BlackjackController,
  STANDARD_BLACKJACK_RULES,
  scoreHand,
  type BlackjackCommand,
  type BlackjackEvent,
  type BlackjackSeat,
  type BlackjackState,
  type BlackjackTableView,
  type HandOutcome,
  type PlayerHand,
} from '../src/blackjack/index.js';
import { DealAnimator, expectOk, formatChips, queryIn } from './ui.js';

type Tone = 'info' | 'win' | 'loss' | 'error';

const PLAYER: PlayerId = playerId('vous');
const SEAT = 0;
const BUY_IN = 1_000;
const CHIP_VALUES = [10, 25, 100, 500] as const;

const TURN_ACTIONS = [
  { action: 'HIT', label: 'Tirer', key: 'H' },
  { action: 'STAND', label: 'Rester', key: 'S' },
  { action: 'DOUBLE_DOWN', label: 'Doubler', key: 'D' },
  { action: 'SPLIT', label: 'Séparer', key: 'P' },
  { action: 'SURRENDER', label: 'Abandonner', key: 'A' },
] as const;

const SIMPLE_COMMANDS = [
  'CLEAR_BET',
  'TAKE_INSURANCE',
  'DECLINE_INSURANCE',
  'HIT',
  'STAND',
  'DOUBLE_DOWN',
  'SPLIT',
  'SURRENDER',
] as const;
type SimpleCommand = (typeof SIMPLE_COMMANDS)[number];
const isSimpleCommand = (value: string): value is SimpleCommand => (SIMPLE_COMMANDS as readonly string[]).includes(value);

const OUTCOME_LABELS: Record<HandOutcome, string> = {
  BLACKJACK: 'Blackjack',
  WIN: 'Gagné',
  PUSH: 'Égalité',
  LOSS: 'Perdu',
  SURRENDER: 'Abandon',
};

function scoreLabel(hand: PlayerHand): string {
  const score = scoreHand(hand);
  if (score.isBlackjack) return 'Blackjack';
  if (score.isBust) return `${score.total} · Bust`;
  return score.isSoft ? `${score.total - 10} / ${score.total}` : String(score.total);
}

function signed(amount: number): string {
  if (amount === 0) return '';
  return amount > 0 ? `+${formatChips(amount)}` : `−${formatChips(-amount)}`;
}

function newTable(engine: BlackjackController): BlackjackState {
  const table = expectOk(engine.createTable(STANDARD_BLACKJACK_RULES));
  return expectOk(
    engine.apply(table, { type: 'SIT_DOWN', playerId: PLAYER, seatIndex: SEAT, displayName: 'Vous', buyIn: chips(BUY_IN) }),
  ).state;
}

function describe(state: BlackjackState, events: readonly BlackjackEvent[]): [string, Tone] {
  switch (state.phase) {
    case 'ROUND_OVER': {
      const net =
        state.settlements.reduce((sum, s) => sum + s.returned - s.stake, 0) +
        state.insuranceSettlements.reduce((sum, s) => sum + s.returned - s.stake, 0);
      const prefix = state.dealerHadBlackjack ? 'Blackjack du croupier. ' : '';
      if (net > 0) return [`${prefix}Vous gagnez ${formatChips(net)} jetons.`, 'win'];
      if (net < 0) return [`${prefix}Vous perdez ${formatChips(-net)} jetons.`, 'loss'];
      return [`${prefix}Égalité : votre mise vous est rendue.`, 'info'];
    }
    case 'INSURANCE':
      return ["Le croupier montre un As. Prenez-vous l'assurance ?", 'info'];
    case 'PLAYER_TURNS': {
      const handCount = state.seats[SEAT]?.hands.length ?? 0;
      if (handCount > 1) return [`Main ${state.cursor.handIndex + 1} sur ${handCount} : à vous de jouer.`, 'info'];
      const peeked = events.some((event) => event.type === 'DEALER_PEEKED');
      return [peeked ? 'Pas de Blackjack pour le croupier. À vous.' : 'À vous de jouer.', 'info'];
    }
    case 'BETTING':
      return ['Posez vos jetons, puis distribuez.', 'info'];
  }
}

export function mountBlackjack(root: HTMLElement): () => void {
  const engine = new BlackjackController(new CryptoRandomSource());
  const animator = new DealAnimator();
  let state = newTable(engine);
  let message = 'Posez vos jetons, puis distribuez.';
  let tone: Tone = 'info';

  root.innerHTML = `
    <div class="game">
      <header class="topbar">
        <a class="back" href="#/">← Lobby</a>
        <h1>Blackjack</h1>
        <div class="bankroll">Bankroll <strong data-bankroll></strong></div>
      </header>
      <section class="felt bj-felt">
        <p class="rules-strip">Le croupier reste sur soft 17 · Blackjack payé 3:2 · Assurance payée 2:1</p>
        <div class="bj-dealer">
          <div class="zone-label">Croupier <span class="score-pill" data-dealer-score></span></div>
          <div class="card-row" data-dealer-cards></div>
        </div>
        <p class="message" data-message aria-live="polite"></p>
        <div class="bj-hands" data-hands></div>
        <p class="shoe-info" data-shoe></p>
      </section>
      <nav class="controls" data-controls></nav>
    </div>`;

  const bankrollEl = queryIn<HTMLElement>(root, '[data-bankroll]');
  const dealerCardsEl = queryIn<HTMLElement>(root, '[data-dealer-cards]');
  const dealerScoreEl = queryIn<HTMLElement>(root, '[data-dealer-score]');
  const messageEl = queryIn<HTMLElement>(root, '[data-message]');
  const handsEl = queryIn<HTMLElement>(root, '[data-hands]');
  const shoeEl = queryIn<HTMLElement>(root, '[data-shoe]');
  const controlsEl = queryIn<HTMLElement>(root, '[data-controls]');

  function renderHands(view: BlackjackTableView, seat: BlackjackSeat): string {
    if (view.phase === 'BETTING') {
      const filled = seat.pendingBet > 0;
      return `<div class="bet-spot ${filled ? 'filled' : ''}"><span>${filled ? formatChips(seat.pendingBet) : 'Mise'}</span></div>`;
    }
    return seat.hands
      .map((hand, index) => {
        const active = view.activeHand?.seatIndex === SEAT && view.activeHand.handIndex === index;
        const settlement = view.settlements.find((s) => s.handId === hand.id);
        const cards = hand.cards
          .map((card, i) => animator.card(`${hand.id}-${i}-${card.rank}${card.suit}`, card))
          .join('');
        const badge =
          settlement === undefined
            ? ''
            : `<span class="badge outcome-${settlement.outcome.toLowerCase()}">${OUTCOME_LABELS[settlement.outcome]} ${signed(settlement.returned - settlement.stake)}</span>`;
        return `
          <article class="bj-hand ${active ? 'active' : ''}">
            <div class="card-row">${cards}</div>
            <div class="hand-meta">
              <span class="score-pill">${scoreLabel(hand)}</span>
              <span class="stake">Mise ${formatChips(hand.bet)}</span>
              ${badge}
            </div>
          </article>`;
      })
      .join('');
  }

  function renderControls(view: BlackjackTableView, seat: BlackjackSeat): string {
    const legal = new Set<string>(view.legalActions.actions);
    const button = (action: string, label: string, enabled: boolean, variant = '', key = ''): string =>
      `<button class="btn ${variant}" data-action="${action}" ${enabled ? '' : 'disabled'}>${label}${key ? `<kbd>${key}</kbd>` : ''}</button>`;

    switch (view.phase) {
      case 'BETTING': {
        if (seat.bankroll + seat.pendingBet < view.rules.minBet) {
          return button('REBUY', `Recaver ${formatChips(BUY_IN)} jetons`, true, 'primary');
        }
        const range = view.legalActions.betRange;
        const rack = CHIP_VALUES.map((value) => {
          const enabled = range !== null && value >= range.min && value <= range.max;
          return `<button class="chip chip-${value}" data-action="chip" data-value="${value}" ${enabled ? '' : 'disabled'} aria-label="Ajouter ${value}">${value}</button>`;
        }).join('');
        return `<div class="chip-rack">${rack}</div>
          ${button('CLEAR_BET', 'Effacer', legal.has('CLEAR_BET'), 'ghost')}
          ${button('DEAL', 'Distribuer', seat.pendingBet > 0, 'primary', '↵')}`;
      }
      case 'INSURANCE': {
        const stake = Math.floor((seat.hands[0]?.bet ?? 0) / 2);
        return (
          button('TAKE_INSURANCE', `Prendre l'assurance (${formatChips(stake)})`, legal.has('TAKE_INSURANCE'), 'primary') +
          button('DECLINE_INSURANCE', 'Refuser', legal.has('DECLINE_INSURANCE'), 'ghost')
        );
      }
      case 'PLAYER_TURNS':
        return TURN_ACTIONS.filter(({ action }) => action !== 'SURRENDER' || view.rules.surrender !== 'NONE')
          .map(({ action, label, key }) => button(action, label, legal.has(action), action === 'STAND' ? 'primary' : '', key))
          .join('');
      case 'ROUND_OVER':
        return button('NEXT_ROUND', 'Nouvelle manche', true, 'primary', '↵');
    }
  }

  function render(): void {
    const view = engine.project(state, PLAYER);
    const seat = view.seats[SEAT] ?? null;
    animator.beginFrame();

    bankrollEl.textContent = formatChips(seat?.bankroll ?? 0);
    dealerCardsEl.innerHTML =
      view.dealerCards
        .map((card, index) =>
          animator.card(`d${view.roundNumber}-${index}-${card.faceUp ? 'up' : 'down'}`, card.faceUp ? card.card : null),
        )
        .join('') || '<div class="card-slot"></div><div class="card-slot"></div>';
    dealerScoreEl.textContent = view.dealerScore === null ? '' : String(view.dealerScore.total);
    messageEl.textContent = message;
    messageEl.dataset['tone'] = tone;
    shoeEl.textContent = `Sabot : ${view.shoe.cardsRemaining} cartes${view.shoe.reshufflePending ? ' · remélange à la prochaine manche' : ''}`;
    handsEl.innerHTML = seat === null ? '' : renderHands(view, seat);
    controlsEl.innerHTML = seat === null ? '' : renderControls(view, seat);
  }

  function dispatch(command: BlackjackCommand): void {
    const result = engine.apply(state, command);
    if (!result.ok) {
      message = result.error.message;
      tone = 'error';
    } else {
      state = result.value.state;
      [message, tone] = describe(state, result.value.events);
    }
    render();
  }

  function onClick(event: MouseEvent): void {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>('button[data-action]');
    if (button === null || button.disabled) return;
    const action = button.dataset['action'] ?? '';

    if (action === 'chip') {
      dispatch({ type: 'PLACE_BET', playerId: PLAYER, amount: chips(Number(button.dataset['value'])) });
    } else if (action === 'DEAL' || action === 'NEXT_ROUND') {
      dispatch({ type: action });
    } else if (action === 'REBUY') {
      state = newTable(engine);
      [message, tone] = [`Nouvelle cave de ${formatChips(BUY_IN)} jetons. Bonne chance !`, 'info'];
      render();
    } else if (isSimpleCommand(action)) {
      dispatch({ type: action, playerId: PLAYER });
    }
  }

  const KEY_ACTIONS: Readonly<Record<string, string>> = { H: 'HIT', S: 'STAND', D: 'DOUBLE_DOWN', P: 'SPLIT', A: 'SURRENDER' };

  function onKey(event: KeyboardEvent): void {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    const selector =
      event.key === 'Enter'
        ? '[data-action="DEAL"], [data-action="NEXT_ROUND"]'
        : `[data-action="${KEY_ACTIONS[event.key.toUpperCase()] ?? '-'}"]`;
    const button = controlsEl.querySelector<HTMLButtonElement>(selector);
    if (button !== null && !button.disabled) {
      event.preventDefault();
      button.click();
    }
  }

  root.addEventListener('click', onClick);
  window.addEventListener('keydown', onKey);
  render();

  return () => {
    root.removeEventListener('click', onClick);
    window.removeEventListener('keydown', onKey);
  };
}
