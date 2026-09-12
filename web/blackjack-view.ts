import { CryptoRandomSource, chips, playerId, type Card, type PlayerId } from '../src/core/index.js';
import {
  BlackjackController,
  STANDARD_BLACKJACK_RULES,
  dealerShouldHit,
  scoreCards,
  scoreHand,
  type BlackjackCommand,
  type BlackjackEvent,
  type BlackjackSeat,
  type BlackjackState,
  type BlackjackTableView,
  type HandOutcome,
  type PlayerHand,
} from '../src/blackjack/index.js';
import { setCheatTarget, xrayEnabled } from './cheat-console.js';
import { DAILY_REFILL, claimDailyRefill, loadLedger, netOf, recordResult, saveBalance, startingBalance } from './money-ledger.js';
import {
  DealAnimator,
  REFILL_DONE_MESSAGE,
  REFILL_USED_MESSAGE,
  cardText,
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
  return amount === 0 ? '' : formatSigned(amount);
}

function roundNet(state: BlackjackState & { phase: 'ROUND_OVER' }): number {
  return (
    state.settlements.reduce((sum, s) => sum + s.returned - s.stake, 0) +
    state.insuranceSettlements.reduce((sum, s) => sum + s.returned - s.stake, 0)
  );
}

/** Jetons engagés sur une manche en cours : perdus si le joueur quitte la table avant la fin. */
function chipsAtRisk(state: BlackjackState): number {
  if (state.phase !== 'INSURANCE' && state.phase !== 'PLAYER_TURNS') return 0;
  const seat = state.seats[SEAT];
  if (seat === null || seat === undefined) return 0;
  const insurance = seat.insurance.status === 'TAKEN' ? seat.insurance.stake : 0;
  return seat.hands.reduce((sum, hand) => sum + hand.bet, 0) + insurance;
}

/** Un joueur ruiné reste debout (le moteur refuse une cave nulle) : seule la recharge du jour lui est proposée. */
function newTable(engine: BlackjackController, buyIn: number): BlackjackState {
  const table = expectOk(engine.createTable(STANDARD_BLACKJACK_RULES));
  if (buyIn === 0) return table;
  return expectOk(
    engine.apply(table, { type: 'SIT_DOWN', playerId: PLAYER, seatIndex: SEAT, displayName: 'Vous', buyIn: chips(buyIn) }),
  ).state;
}

function describe(state: BlackjackState, events: readonly BlackjackEvent[]): [string, Tone] {
  switch (state.phase) {
    case 'ROUND_OVER': {
      const net = roundNet(state);
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
  let state = newTable(engine, startingBalance('blackjack'));
  let message = (state.seats[SEAT] ?? null) === null ? "Vous n'avez plus de jetons." : 'Posez vos jetons, puis distribuez.';
  let tone: Tone = 'info';

  root.innerHTML = `
    <div class="game">
      <header class="topbar">
        <a class="back" href="#/">← Lobby</a>
        <h1>Blackjack</h1>
        <div class="topbar-stats">
          <div class="bankroll">Bilan <strong data-ledger></strong></div>
          <div class="bankroll">Bankroll <strong data-bankroll></strong></div>
        </div>
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
  const ledgerEl = queryIn<HTMLElement>(root, '[data-ledger]');
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
          return refillButtonHtml('blackjack');
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

  /** Carte réelle derrière une carte face cachée du croupier, si les rayons X sont actifs. */
  const hiddenCard = (index: number): Card | null => (xrayEnabled() ? (state.dealer.cards[index] ?? null) : null);

  function render(): void {
    const view = engine.project(state, PLAYER);
    const seat = view.seats[SEAT] ?? null;
    animator.beginFrame();

    bankrollEl.textContent = formatChips(seat?.bankroll ?? 0);
    // Les mises engagées dans une manche en cours ne sont pas sauvegardées : quitter la table les abandonne.
    if (seat !== null) saveBalance('blackjack', seat.bankroll + seat.pendingBet);
    const net = netOf(loadLedger().blackjack);
    ledgerEl.textContent = formatSigned(net);
    ledgerEl.className = signClass(net);
    dealerCardsEl.innerHTML =
      view.dealerCards
        .map((card, index) =>
          animator.card(
            `d${view.roundNumber}-${index}-${card.faceUp ? 'up' : 'down'}`,
            card.faceUp ? card.card : hiddenCard(index),
            false,
            !card.faceUp && xrayEnabled(),
          ),
        )
        .join('') || '<div class="card-slot"></div><div class="card-slot"></div>';
    dealerScoreEl.textContent = view.dealerScore === null ? '' : String(view.dealerScore.total);
    messageEl.textContent = message;
    messageEl.dataset['tone'] = tone;
    shoeEl.textContent = `Sabot : ${view.shoe.cardsRemaining} cartes${view.shoe.reshufflePending ? ' · remélange à la prochaine manche' : ''}`;
    handsEl.innerHTML = seat === null ? '' : renderHands(view, seat);
    controlsEl.innerHTML = seat === null ? refillButtonHtml('blackjack') : renderControls(view, seat);
  }

  function dispatch(command: BlackjackCommand): void {
    const result = engine.apply(state, command);
    if (!result.ok) {
      message = result.error.message;
      tone = 'error';
    } else {
      const wasOver = state.phase === 'ROUND_OVER';
      state = result.value.state;
      if (!wasOver && state.phase === 'ROUND_OVER') recordResult('blackjack', roundNet(state));
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
      const seat = engine.project(state, PLAYER).seats[SEAT] ?? null;
      if (claimDailyRefill('blackjack')) {
        state = newTable(engine, (seat === null ? 0 : seat.bankroll + seat.pendingBet) + DAILY_REFILL);
        [message, tone] = [REFILL_DONE_MESSAGE, 'win'];
      } else {
        [message, tone] = [REFILL_USED_MESSAGE, 'error'];
      }
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

  /** Déroule le tirage du croupier à partir de la carte `from` du sabot, comme si le joueur restait. */
  function dealerDraw(dealerCards: readonly Card[], from: number): string {
    const cards = [...dealerCards];
    const drawn: Card[] = [];
    for (let index = from; dealerShouldHit(scoreCards(cards), state.rules); index += 1) {
      const card = state.shoe.cards[index];
      if (card === undefined) break;
      cards.push(card);
      drawn.push(card);
    }
    const score = scoreCards(cards);
    const total = score.isBust ? `${score.total}, bust` : String(score.total);
    return drawn.length === 0 ? `ne tirera pas (${total})` : `tirera ${drawn.map(cardText).join(' ')} (${total})`;
  }

  function foresee(): string {
    const { cards, nextIndex } = state.shoe;

    if (state.phase === 'BETTING' || state.phase === 'ROUND_OVER') {
      if (engine.project(state, PLAYER).shoe.reshufflePending) {
        return 'Le sabot sera remélangé avant la prochaine manche : l’avenir est flou.';
      }
      // Ordre de la donne : joueur, croupier (visible), joueur, croupier (cachée).
      const [mine1, dealerUp, mine2, dealerHole] = cards.slice(nextIndex, nextIndex + 4);
      if (mine1 === undefined || dealerUp === undefined || mine2 === undefined || dealerHole === undefined) {
        return 'Le sabot est presque vide.';
      }
      const mine = [mine1, mine2];
      const dealer = [dealerUp, dealerHole];
      let outcome = `Si je reste sur ces 2 cartes, le croupier ${dealerDraw(dealer, nextIndex + 4)}.`;
      if (scoreCards(dealer).isBlackjack) outcome = 'Le croupier aura Blackjack.';
      else if (scoreCards(mine).isBlackjack) outcome = 'Vous aurez Blackjack !';
      return [
        `Prochaines cartes du croupier : ${cardText(dealerUp)} (visible) · ${cardText(dealerHole)} (cachée)`,
        `Mes prochaines cartes : ${mine.map(cardText).join(' ')}`,
        outcome,
      ].join('\n');
    }

    const hole = state.dealer.cards[1];
    const dealerScore = scoreCards(state.dealer.cards);
    const nextMine = cards.slice(nextIndex, nextIndex + 5).map(cardText).join(' ');
    return [
      `Carte cachée du croupier : ${hole === undefined ? '—' : cardText(hole)} (total ${dealerScore.total})`,
      `Mes prochaines cartes : ${nextMine || '—'}`,
      dealerScore.isBlackjack
        ? 'Le croupier a Blackjack.'
        : `Si je reste sur toutes mes mains, le croupier ${dealerDraw(state.dealer.cards, nextIndex)}.`,
    ].join('\n');
  }

  setCheatTarget({
    games: ['blackjack'],
    getBalance: () => state.seats[SEAT]?.bankroll ?? 0,
    setBalance: (_game, amount) => {
      const seat = state.seats[SEAT];
      if (seat === null || seat === undefined) {
        // Joueur ruiné, donc debout : le nouveau solde le rassoit.
        state = newTable(engine, amount);
        render();
        return null;
      }
      state = { ...state, seats: state.seats.with(SEAT, { ...seat, bankroll: chips(amount) }) };
      render();
      return null;
    },
    refresh: render,
    foresee,
  });

  root.addEventListener('click', onClick);
  window.addEventListener('keydown', onKey);
  render();

  return () => {
    const abandoned = chipsAtRisk(state);
    if (abandoned > 0) recordResult('blackjack', -abandoned);
    setCheatTarget(null);
    root.removeEventListener('click', onClick);
    window.removeEventListener('keydown', onKey);
  };
}
