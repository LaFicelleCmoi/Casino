import {
  EngineError,
  ZERO_CHIPS,
  addChips,
  beginRound,
  cardsRemaining,
  createShoe,
  drawCardOrRecycle,
  err,
  invariant,
  isChips,
  isCutCardReached,
  ok,
  type Card,
  type ChipRange,
  type PlayerId,
  type RandomSource,
  type Result,
  type SeatIndex,
  type ShoeState,
  type Transition,
  type VisibleCard,
} from '../../core/index.js';
import { BlackjackBetManager } from '../betting/bet-manager.js';
import {
  canDouble,
  canHit,
  canSplit,
  canSurrender,
  dealerShouldHit,
  dealerShouldPeek,
  isInsuranceOffered,
  resolveOutcome,
  scoreCards,
  scoreHand,
} from '../evaluation/hand-evaluator.js';
import { validateBlackjackRules, type BlackjackRules } from '../rules.js';
import {
  BLACKJACK_COMMAND_PHASES,
  type BlackjackCommand,
  type BlackjackDealerAction,
  type BlackjackPlayerAction,
  type BlackjackPlayerActionType,
} from '../types/actions.js';
import type { BlackjackEngine, BlackjackLegalActions, BlackjackTableView } from '../types/contract.js';
import type { BlackjackEvent, BlackjackViewEvent } from '../types/events.js';
import type {
  DealerHand,
  HandId,
  HandSettlement,
  InsuranceSettlement,
  PlayerHand,
  PlayerHandStatus,
} from '../types/hand.js';
import type {
  BettingPhase,
  BlackjackSeat,
  BlackjackState,
  BlackjackTableBase,
  DealerTurnPhase,
  HandCursor,
  InsurancePhase,
  PlayerTurnsPhase,
  RoundOverPhase,
} from '../types/state.js';

type Table = BlackjackTableBase;
type Step = Result<Transition<BlackjackState, BlackjackEvent>>;
type SeatCommand = Exclude<BlackjackPlayerAction, { readonly type: 'SIT_DOWN' }>;
type SitDown = Extract<BlackjackCommand, { readonly type: 'SIT_DOWN' }>;
type TurnActionType = 'HIT' | 'STAND' | 'DOUBLE_DOWN' | 'SPLIT' | 'SURRENDER';

const EMPTY_DEALER: DealerHand = { cards: [], holeCardRevealed: false };
const NO_ACTIONS: BlackjackLegalActions = { actions: [], betRange: null, boxRanges: [] };

function done(state: BlackjackState, events: readonly BlackjackEvent[] = []): Step {
  return ok({ state, events });
}

/** Retire les champs propres à une phase (cursor, settlements…) avant d'en construire une autre. */
function tableOf(state: BlackjackState): Table {
  const { rules, roundNumber, shoe, seats, dealer } = state;
  return { rules, roundNumber, shoe, seats, dealer };
}

function findSeat(state: Table, playerId: PlayerId): BlackjackSeat | null {
  return state.seats.find((seat) => seat?.player.id === playerId) ?? null;
}

function setSeat<S extends Table>(table: S, index: SeatIndex, seat: BlackjackSeat | null): S {
  return { ...table, seats: table.seats.with(index, seat) };
}

/** Places restantes : chaque joueur assis en occupe une, chaque case misée au-delà de la première en prend une de plus. */
function freePlaces(table: Table): number {
  const used = table.seats.reduce((sum, seat) => sum + (seat === null ? 0 : Math.max(1, seat.pendingBets.length)), 0);
  return table.rules.seatCount - used;
}

/** Le croupier ne tire que s'il reste une main à battre (restée ou doublée) : sinon ses cartes ne changent rien. */
function needsDealer(table: Table): boolean {
  return table.seats.some((seat) => seat?.hands.some((hand) => hand.status === 'STOOD' || hand.status === 'DOUBLED'));
}

function handId(roundNumber: number, seatIndex: SeatIndex, ordinal: number): HandId {
  return `r${roundNumber}-s${seatIndex}-h${ordinal}` as HandId;
}

function handAt(table: Table, cursor: HandCursor): { seat: BlackjackSeat; hand: PlayerHand } {
  const seat = table.seats[cursor.seatIndex];
  const hand = seat?.hands[cursor.handIndex];
  invariant(seat !== null && seat !== undefined && hand !== undefined, `Main introuvable : ${JSON.stringify(cursor)}`);
  return { seat, hand };
}

function replaceHand(table: Table, cursor: HandCursor, hand: PlayerHand): Table {
  const { seat } = handAt(table, cursor);
  return setSeat(table, seat.seatIndex, { ...seat, hands: seat.hands.with(cursor.handIndex, hand) });
}

function setStatus(table: Table, cursor: HandCursor, status: PlayerHandStatus, events: BlackjackEvent[]): Table {
  const { seat, hand } = handAt(table, cursor);
  if (hand.status === status) return table;
  events.push({ type: 'HAND_STATUS_CHANGED', seatIndex: seat.seatIndex, handId: hand.id, status });
  return replaceHand(table, cursor, { ...hand, status });
}

/** Ordre de jeu : sièges de gauche à droite, puis mains dans l'ordre (cases, et mains splittées après leur main d'origine). */
function firstPlayableHand(seats: readonly (BlackjackSeat | null)[]): HandCursor | null {
  for (const seat of seats) {
    if (seat === null) continue;
    const handIndex = seat.hands.findIndex((hand) => hand.status === 'PLAYING');
    if (handIndex !== -1) return { seatIndex: seat.seatIndex, handIndex };
  }
  return null;
}

/**
 * Game Controller du Blackjack : orchestre la state machine, applique les règles et pilote l'IA du croupier.
 * Pur à l'aléa injecté près : aucune mutation de l'état reçu.
 */
export class BlackjackController implements BlackjackEngine {
  readonly #rng: RandomSource;

  constructor(rng: RandomSource) {
    this.#rng = rng;
  }

  createTable(rules: BlackjackRules): Result<BettingPhase> {
    const validated = validateBlackjackRules(rules);
    if (!validated.ok) return validated;
    const table: BettingPhase = {
      phase: 'BETTING',
      rules,
      roundNumber: 0,
      shoe: this.#newShoe(rules),
      seats: Array.from({ length: rules.seatCount }, () => null),
      dealer: EMPTY_DEALER,
    };
    return ok(table);
  }

  apply(state: BlackjackState, command: BlackjackCommand): Step {
    const allowedPhases: readonly string[] = BLACKJACK_COMMAND_PHASES[command.type];
    if (!allowedPhases.includes(state.phase)) {
      return err(new EngineError('ILLEGAL_PHASE', `${command.type} impossible pendant la phase ${state.phase}`));
    }
    try {
      switch (command.type) {
        case 'DEAL':
          return this.#deal(state);
        case 'NEXT_ROUND':
          return done(this.#nextRound(state));
        case 'REVEAL_HOLE_CARD':
        case 'DEALER_HIT':
        case 'DEALER_STAND':
          return this.#dealerAction(state, command.type);
        case 'SIT_DOWN':
          return this.#sitDown(state, command);
        default:
          return this.#seatCommand(state, command);
      }
    } catch (error) {
      // Seules les erreurs métier (ex. sabot épuisé) deviennent un Result ; un bug reste une exception.
      if (error instanceof EngineError) return err(error);
      throw error;
    }
  }

  legalActions(state: BlackjackState, playerId: PlayerId): BlackjackLegalActions {
    const seat = findSeat(state, playerId);

    if (seat === null) {
      const canSit =
        (state.phase === 'BETTING' || state.phase === 'ROUND_OVER') && state.seats.includes(null) && freePlaces(state) >= 1;
      return canSit ? { ...NO_ACTIONS, actions: ['SIT_DOWN'] } : NO_ACTIONS;
    }

    const bets = new BlackjackBetManager(state.rules);
    switch (state.phase) {
      case 'BETTING': {
        const boxRanges = this.#boxRanges(state, seat);
        const actions: BlackjackPlayerActionType[] = ['LEAVE_SEAT'];
        if (boxRanges.some((range) => range !== null)) actions.push('PLACE_BET');
        if (seat.pendingBets.length > 0) actions.push('CLEAR_BET');
        return { actions, betRange: boxRanges[0] ?? null, boxRanges };
      }
      case 'INSURANCE': {
        if (seat.insurance.status !== 'PENDING') return NO_ACTIONS;
        const stake = bets.insuranceStake(seat);
        const affordable = stake > 0 && seat.bankroll >= stake;
        return { ...NO_ACTIONS, actions: affordable ? ['TAKE_INSURANCE', 'DECLINE_INSURANCE'] : ['DECLINE_INSURANCE'] };
      }
      case 'PLAYER_TURNS': {
        const hand = seat.hands[state.cursor.handIndex];
        if (state.cursor.seatIndex !== seat.seatIndex || hand === undefined) return NO_ACTIONS;

        const { rules } = state;
        const canMatchBet = seat.bankroll >= hand.bet;
        const actions: BlackjackPlayerActionType[] = [];
        if (canHit(hand, rules)) actions.push('HIT');
        if (hand.status === 'PLAYING') actions.push('STAND');
        if (canMatchBet && canDouble(hand, rules)) actions.push('DOUBLE_DOWN');
        if (canMatchBet && canSplit(seat, hand, rules)) actions.push('SPLIT');
        if (canSurrender(seat, hand, rules)) actions.push('SURRENDER');
        return { ...NO_ACTIONS, actions };
      }
      case 'DEALER_TURN':
        return NO_ACTIONS;
      case 'ROUND_OVER':
        return { ...NO_ACTIONS, actions: ['LEAVE_SEAT'] };
    }
  }

  project(state: BlackjackState, viewer: PlayerId | null): BlackjackTableView {
    const { dealer } = state;
    const dealerCards = dealer.cards.map(
      (card, index): VisibleCard => (index === 1 && !dealer.holeCardRevealed ? { faceUp: false } : { faceUp: true, card }),
    );
    const visibleDealerCards = dealer.holeCardRevealed ? dealer.cards : dealer.cards.slice(0, 1);

    return {
      phase: state.phase,
      roundNumber: state.roundNumber,
      rules: state.rules,
      viewer,
      viewerSeat: viewer === null ? null : (findSeat(state, viewer)?.seatIndex ?? null),
      seats: state.seats,
      freePlaces: freePlaces(state),
      dealerCards,
      dealerScore: visibleDealerCards.length === 0 ? null : scoreCards(visibleDealerCards),
      shoe: { cardsRemaining: cardsRemaining(state.shoe), reshufflePending: isCutCardReached(state.shoe) },
      activeHand: state.phase === 'PLAYER_TURNS' ? state.cursor : null,
      settlements: state.phase === 'ROUND_OVER' ? state.settlements : [],
      insuranceSettlements: state.phase === 'ROUND_OVER' ? state.insuranceSettlements : [],
      dealerActions: this.dealerActions(state),
      legalActions: viewer === null ? NO_ACTIONS : this.legalActions(state, viewer),
    };
  }

  /** Au Blackjack, seule la hole card du croupier est secrète : les cartes des joueurs sont publiques. */
  projectEvent(event: BlackjackEvent, _viewer: PlayerId | null): BlackjackViewEvent {
    if (event.type !== 'CARD_DEALT') return event;
    return { ...event, card: event.faceUp ? { faceUp: true, card: event.card } : { faceUp: false } };
  }

  /**
   * Geste attendu du croupier humain (règle MANUAL) pendant DEALER_TURN : retourner la hole card, puis le seul geste
   * que permettent les règles — tirer sous 17 s'il reste une main à battre, sinon s'arrêter et payer.
   */
  dealerActions(state: BlackjackState): readonly BlackjackDealerAction[] {
    if (state.phase !== 'DEALER_TURN') return [];
    if (!state.dealer.holeCardRevealed) return ['REVEAL_HOLE_CARD'];
    const mustHit = needsDealer(state) && dealerShouldHit(scoreCards(state.dealer.cards), state.rules);
    return [mustHit ? 'DEALER_HIT' : 'DEALER_STAND'];
  }

  // ─── Gestion des sièges et des mises ────────────────────────────────────────

  /** Bornes de chaque case misée, puis de la case suivante si une place libre permet de l'ouvrir. */
  #boxRanges(table: Table, seat: BlackjackSeat): (ChipRange | null)[] {
    const bets = new BlackjackBetManager(table.rules);
    const ranges = seat.pendingBets.map((_, box) => bets.betRange(seat, box));
    const next = seat.pendingBets.length;
    ranges.push(next === 0 || freePlaces(table) >= 1 ? bets.betRange(seat, next) : null);
    return ranges;
  }

  #sitDown(state: BlackjackState, command: SitDown): Step {
    const { seatIndex, buyIn, playerId } = command;
    if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= state.rules.seatCount) {
      return err(new EngineError('SEAT_OUT_OF_RANGE', `Siège ${seatIndex} inexistant`));
    }
    if (state.seats[seatIndex] !== null) {
      return err(new EngineError('SEAT_TAKEN', `Le siège ${seatIndex} est occupé`));
    }
    if (findSeat(state, playerId) !== null) {
      return err(new EngineError('ALREADY_SEATED', 'Ce joueur est déjà assis à la table'));
    }
    if (freePlaces(state) < 1) {
      return err(new EngineError('SEAT_TAKEN', 'Plus aucune place libre : les mains jouées occupent toute la table'));
    }
    if (!isChips(buyIn) || buyIn === 0) {
      return err(new EngineError('INVALID_AMOUNT', `Cave invalide : ${buyIn}`));
    }
    const seat: BlackjackSeat = {
      seatIndex,
      player: { id: playerId, displayName: command.displayName.trim() || `Joueur ${seatIndex + 1}` },
      bankroll: buyIn,
      pendingBets: [],
      hands: [],
      insurance: { status: 'NOT_OFFERED' },
    };
    return done(setSeat(state, seatIndex, seat), [{ type: 'PLAYER_SAT_DOWN', seatIndex, playerId, bankroll: buyIn }]);
  }

  #seatCommand(state: BlackjackState, command: SeatCommand): Step {
    const seat = findSeat(state, command.playerId);
    if (seat === null) {
      return err(new EngineError('UNKNOWN_PLAYER', "Ce joueur n'est pas assis à la table"));
    }
    // Source de vérité unique : une commande n'est acceptée que si legalActions la propose.
    if (!this.legalActions(state, command.playerId).actions.includes(command.type)) {
      const notYourTurn = state.phase === 'PLAYER_TURNS' && state.cursor.seatIndex !== seat.seatIndex;
      return err(
        new EngineError(notYourTurn ? 'NOT_YOUR_TURN' : 'ILLEGAL_ACTION', `${command.type} n'est pas autorisé maintenant`),
      );
    }

    const bets = new BlackjackBetManager(state.rules);
    switch (command.type) {
      case 'LEAVE_SEAT':
        return done(setSeat(state, seat.seatIndex, null), [
          { type: 'PLAYER_LEFT', seatIndex: seat.seatIndex, playerId: seat.player.id },
        ]);
      case 'PLACE_BET': {
        const box = command.box ?? 0;
        if (box > 0 && box === seat.pendingBets.length && freePlaces(state) < 1) {
          return err(new EngineError('ILLEGAL_ACTION', 'Aucune place libre pour jouer une main de plus'));
        }
        const placed = bets.placeBet(seat, command.amount, box);
        if (!placed.ok) return placed;
        return done(setSeat(state, seat.seatIndex, placed.value), [
          { type: 'BET_PLACED', seatIndex: seat.seatIndex, box, amount: command.amount },
        ]);
      }
      case 'CLEAR_BET':
        return done(setSeat(state, seat.seatIndex, bets.clearBet(seat)), [
          { type: 'BET_CLEARED', seatIndex: seat.seatIndex },
        ]);
      case 'TAKE_INSURANCE':
      case 'DECLINE_INSURANCE':
        return this.#decideInsurance(state, seat, command.type === 'TAKE_INSURANCE');
      case 'HIT':
      case 'STAND':
      case 'DOUBLE_DOWN':
      case 'SPLIT':
      case 'SURRENDER':
        invariant(state.phase === 'PLAYER_TURNS', 'Action de jeu hors du tour des joueurs');
        return this.#turnAction(state, seat, command.type);
    }
  }

  // ─── Distribution ──────────────────────────────────────────────────────────

  #deal(state: BlackjackState): Step {
    if (!state.seats.some((seat) => seat !== null && seat.pendingBets.length > 0)) {
      return err(new EngineError('NOT_ENOUGH_PLAYERS', 'Aucune mise posée'));
    }
    const events: BlackjackEvent[] = [];
    const roundNumber = state.roundNumber + 1;
    let table: Table = { ...tableOf(state), roundNumber, dealer: EMPTY_DEALER };

    if (isCutCardReached(table.shoe)) {
      table = { ...table, shoe: this.#newShoe(table.rules) };
      events.push({ type: 'SHOE_SHUFFLED', deckCount: table.rules.deckCount });
    }
    table = {
      ...table,
      shoe: beginRound(table.shoe),
      seats: table.seats.map((seat): BlackjackSeat | null => {
        if (seat === null) return null;
        const hands = seat.pendingBets.map(
          (bet, box): PlayerHand => ({
            id: handId(roundNumber, seat.seatIndex, box),
            cards: [],
            bet,
            status: 'PLAYING',
            fromSplit: false,
            isSplitAces: false,
            box,
          }),
        );
        return { ...seat, pendingBets: [], hands, insurance: { status: 'NOT_OFFERED' } };
      }),
    };

    // Deux passages : une carte par main (sièges puis cases) puis le croupier face visible, puis la hole card face cachée.
    const cursors: HandCursor[] = table.seats.flatMap((seat) =>
      seat === null ? [] : seat.hands.map((_, handIndex) => ({ seatIndex: seat.seatIndex, handIndex })),
    );
    for (const faceUp of [true, false]) {
      for (const cursor of cursors) table = this.#dealToHand(table, cursor, events);
      table = this.#dealToDealer(table, faceUp, events);
    }

    for (const cursor of cursors) {
      if (scoreHand(handAt(table, cursor).hand).isBlackjack) {
        table = setStatus(table, cursor, 'BLACKJACK', events);
      }
    }

    const upCard = table.dealer.cards[0];
    invariant(upCard !== undefined, 'Le croupier doit avoir une carte visible');
    if (isInsuranceOffered(upCard, table.rules)) {
      events.push({ type: 'INSURANCE_OFFERED' });
      const insurancePhase: InsurancePhase = {
        ...table,
        phase: 'INSURANCE',
        seats: table.seats.map(
          (seat): BlackjackSeat | null =>
            seat === null || seat.hands.length === 0 ? seat : { ...seat, insurance: { status: 'PENDING' } },
        ),
      };
      return done(insurancePhase, events);
    }
    return done(this.#afterInsurance(table, events), events);
  }

  #decideInsurance(state: BlackjackState, seat: BlackjackSeat, take: boolean): Step {
    const bets = new BlackjackBetManager(state.rules);
    const decided = take ? bets.takeInsurance(seat) : bets.declineInsurance(seat);
    if (!decided.ok) return decided;

    const { insurance } = decided.value;
    const events: BlackjackEvent[] = [
      {
        type: 'INSURANCE_DECIDED',
        seatIndex: seat.seatIndex,
        taken: take,
        stake: insurance.status === 'TAKEN' ? insurance.stake : ZERO_CHIPS,
      },
    ];
    const table = setSeat(tableOf(state), seat.seatIndex, decided.value);
    if (table.seats.some((s) => s?.insurance.status === 'PENDING')) {
      const stillDeciding: InsurancePhase = { ...table, phase: 'INSURANCE' };
      return done(stillDeciding, events);
    }
    return done(this.#afterInsurance(table, events), events);
  }

  /** Peek du croupier : un Blackjack termine la manche immédiatement, avant toute action des joueurs. */
  #afterInsurance(table: Table, events: BlackjackEvent[]): BlackjackState {
    const upCard = table.dealer.cards[0];
    invariant(upCard !== undefined, 'Le croupier doit avoir une carte visible');
    if (dealerShouldPeek(upCard, table.rules)) {
      const hasBlackjack = scoreCards(table.dealer.cards).isBlackjack;
      events.push({ type: 'DEALER_PEEKED', hasBlackjack });
      if (hasBlackjack) return this.#finishRound(table, events);
    }
    return this.#nextTurn(table, events);
  }

  // ─── Tour des joueurs ──────────────────────────────────────────────────────

  #turnAction(state: PlayerTurnsPhase, seat: BlackjackSeat, type: TurnActionType): Step {
    const { cursor } = state;
    const events: BlackjackEvent[] = [];
    let table = tableOf(state);

    switch (type) {
      case 'HIT': {
        table = this.#dealToHand(table, cursor, events);
        const score = scoreHand(handAt(table, cursor).hand);
        if (score.isBust) table = setStatus(table, cursor, 'BUSTED', events);
        else if (score.total === 21) table = setStatus(table, cursor, 'STOOD', events);
        break;
      }
      case 'STAND':
        table = setStatus(table, cursor, 'STOOD', events);
        break;
      case 'SURRENDER':
        table = setStatus(table, cursor, 'SURRENDERED', events);
        break;
      case 'DOUBLE_DOWN': {
        const doubled = new BlackjackBetManager(table.rules).doubleDown(seat, cursor.handIndex);
        if (!doubled.ok) return doubled;
        table = setSeat(table, seat.seatIndex, doubled.value);
        const { hand } = handAt(table, cursor);
        events.push({ type: 'HAND_DOUBLED', seatIndex: seat.seatIndex, handId: hand.id, newBet: hand.bet });
        table = this.#dealToHand(table, cursor, events);
        const bust = scoreHand(handAt(table, cursor).hand).isBust;
        table = setStatus(table, cursor, bust ? 'BUSTED' : 'DOUBLED', events);
        break;
      }
      case 'SPLIT': {
        const split = this.#split(table, seat, cursor, events);
        if (!split.ok) return split;
        table = split.value;
        break;
      }
    }

    const next: BlackjackState =
      handAt(table, cursor).hand.status === 'PLAYING'
        ? { ...table, phase: 'PLAYER_TURNS', cursor }
        : this.#nextTurn(table, events);
    return done(next, events);
  }

  /** Le split crée une seconde main indépendante (mise, cartes, statut) sur la même case, jouée juste après la main d'origine. */
  #split(table: Table, seat: BlackjackSeat, cursor: HandCursor, events: BlackjackEvent[]): Result<Table> {
    const reserved = new BlackjackBetManager(table.rules).reserveHandStake(seat, cursor.handIndex);
    if (!reserved.ok) return reserved;

    const { seat: debited, stake } = reserved.value;
    const hand = debited.hands[cursor.handIndex];
    const [first, second] = hand?.cards ?? [];
    invariant(hand !== undefined && first !== undefined && second !== undefined, 'Split sans paire');

    const isSplitAces = first.rank === 'A';
    const kept: PlayerHand = { ...hand, cards: [first], fromSplit: true, isSplitAces };
    const created: PlayerHand = {
      id: handId(table.roundNumber, seat.seatIndex, debited.hands.length),
      cards: [second],
      bet: stake,
      status: 'PLAYING',
      fromSplit: true,
      isSplitAces,
      box: hand.box,
    };
    const hands = debited.hands.toSpliced(cursor.handIndex, 1, kept, created);
    let next = setSeat(table, seat.seatIndex, { ...debited, hands });
    events.push({ type: 'HAND_SPLIT', seatIndex: seat.seatIndex, handId: hand.id, newHandId: created.id });

    for (const handIndex of [cursor.handIndex, cursor.handIndex + 1]) {
      const target = { seatIndex: seat.seatIndex, handIndex };
      next = this.#dealToHand(next, target, events);
      const dealt = handAt(next, target).hand;
      const canResplitAces = next.rules.resplitAces && dealt.cards[1]?.rank === 'A';
      const lockedAce = isSplitAces && !next.rules.hitSplitAces && !canResplitAces;
      if (lockedAce || scoreHand(dealt).total === 21) {
        next = setStatus(next, target, 'STOOD', events);
      }
    }
    return ok(next);
  }

  #nextTurn(table: Table, events: BlackjackEvent[]): BlackjackState {
    const cursor = firstPlayableHand(table.seats);
    if (cursor === null) {
      if (table.rules.dealerPlay === 'AUTO') return this.#finishRound(table, events);
      events.push({ type: 'DEALER_TURN_STARTED' });
      const dealerTurn: DealerTurnPhase = { ...table, phase: 'DEALER_TURN' };
      return dealerTurn;
    }
    events.push({ type: 'TURN_STARTED', cursor });
    const turn: PlayerTurnsPhase = { ...table, phase: 'PLAYER_TURNS', cursor };
    return turn;
  }

  // ─── Croupier et règlement ─────────────────────────────────────────────────

  /** Geste du croupier humain, validé contre le seul geste que les règles autorisent à cet instant. */
  #dealerAction(state: BlackjackState, type: BlackjackDealerAction): Step {
    invariant(state.phase === 'DEALER_TURN', 'Geste du croupier hors de son tour');
    const [expected] = this.dealerActions(state);
    if (expected !== type) {
      const reason =
        expected === 'REVEAL_HOLE_CARD'
          ? 'Retournez d’abord la carte cachée.'
          : type === 'REVEAL_HOLE_CARD'
            ? 'La carte cachée est déjà retournée.'
            : expected === 'DEALER_HIT'
              ? 'Le croupier doit tirer : moins de 17 face à une main à battre.'
              : 'Le croupier doit s’arrêter : 17 ou plus, ou plus aucune main à battre.';
      return err(new EngineError('ILLEGAL_ACTION', reason));
    }

    const events: BlackjackEvent[] = [];
    const table = tableOf(state);
    switch (type) {
      case 'REVEAL_HOLE_CARD': {
        const turn: DealerTurnPhase = { ...this.#revealHoleCard(table, events), phase: 'DEALER_TURN' };
        return done(turn, events);
      }
      case 'DEALER_HIT': {
        const turn: DealerTurnPhase = { ...this.#dealToDealer(table, true, events), phase: 'DEALER_TURN' };
        return done(turn, events);
      }
      case 'DEALER_STAND':
        return done(this.#settle(table, events), events);
    }
  }

  /** IA du croupier (règle AUTO, ou Blackjack découvert au peek) : retourne la hole card, tire selon les règles, puis règle. */
  #finishRound(table: Table, events: BlackjackEvent[]): RoundOverPhase {
    let current = this.#revealHoleCard(table, events);
    // Inutile de tirer si aucune main ne reste à comparer (toutes bust, abandonnées ou Blackjack).
    while (needsDealer(current) && dealerShouldHit(scoreCards(current.dealer.cards), current.rules)) {
      current = this.#dealToDealer(current, true, events);
    }
    return this.#settle(current, events);
  }

  #revealHoleCard(table: Table, events: BlackjackEvent[]): Table {
    if (table.dealer.holeCardRevealed) return table;
    const holeCard = table.dealer.cards[1];
    invariant(holeCard !== undefined, 'Hole card absente');
    events.push({ type: 'HOLE_CARD_REVEALED', card: holeCard });
    return { ...table, dealer: { ...table.dealer, holeCardRevealed: true } };
  }

  /** Paie chaque main et chaque assurance contre la main finale du croupier. */
  #settle(current: Table, events: BlackjackEvent[]): RoundOverPhase {
    const dealerScore = scoreCards(current.dealer.cards);
    events.push({ type: 'DEALER_FINISHED', score: dealerScore });

    const bets = new BlackjackBetManager(current.rules);
    const settlements: HandSettlement[] = [];
    const insuranceSettlements: InsuranceSettlement[] = [];
    const seats = current.seats.map((seat): BlackjackSeat | null => {
      if (seat === null || seat.hands.length === 0) return seat;
      let bankroll = seat.bankroll;

      for (const hand of seat.hands) {
        const outcome = resolveOutcome(hand, dealerScore);
        const settlement: HandSettlement = {
          seatIndex: seat.seatIndex,
          handId: hand.id,
          outcome,
          playerScore: scoreHand(hand),
          dealerScore,
          stake: hand.bet,
          returned: bets.returnedFor(outcome, hand.bet),
        };
        settlements.push(settlement);
        events.push({ type: 'HAND_SETTLED', settlement });
        bankroll = addChips(bankroll, settlement.returned);
      }

      if (seat.insurance.status === 'TAKEN') {
        const returned = bets.insuranceReturned(seat.insurance.stake, dealerScore.isBlackjack);
        insuranceSettlements.push({ seatIndex: seat.seatIndex, stake: seat.insurance.stake, returned });
        events.push({ type: 'INSURANCE_SETTLED', seatIndex: seat.seatIndex, returned });
        bankroll = addChips(bankroll, returned);
      }
      return { ...seat, bankroll };
    });

    events.push({ type: 'ROUND_ENDED', roundNumber: current.roundNumber });
    return {
      ...current,
      seats,
      phase: 'ROUND_OVER',
      dealerHadBlackjack: dealerScore.isBlackjack,
      settlements,
      insuranceSettlements,
    };
  }

  #nextRound(state: BlackjackState): BettingPhase {
    const table = tableOf(state);
    return {
      ...table,
      phase: 'BETTING',
      dealer: EMPTY_DEALER,
      seats: table.seats.map(
        (seat): BlackjackSeat | null => (seat === null ? null : { ...seat, hands: [], insurance: { status: 'NOT_OFFERED' } }),
      ),
    };
  }

  // ─── Sabot ─────────────────────────────────────────────────────────────────

  #newShoe(rules: BlackjackRules): ShoeState {
    const shoe = createShoe({ deckCount: rules.deckCount, penetration: rules.penetration }, this.#rng);
    if (!shoe.ok) throw shoe.error;
    return shoe.value;
  }

  #draw(table: Table): { card: Card; table: Table } {
    const drawn = drawCardOrRecycle(table.shoe, this.#rng);
    if (!drawn.ok) throw drawn.error;
    return { card: drawn.value.card, table: { ...table, shoe: drawn.value.shoe } };
  }

  #dealToHand(table: Table, cursor: HandCursor, events: BlackjackEvent[]): Table {
    const { card, table: next } = this.#draw(table);
    const { seat, hand } = handAt(next, cursor);
    events.push({
      type: 'CARD_DEALT',
      target: { kind: 'PLAYER', seatIndex: seat.seatIndex, handId: hand.id },
      card,
      faceUp: true,
    });
    return replaceHand(next, cursor, { ...hand, cards: [...hand.cards, card] });
  }

  #dealToDealer(table: Table, faceUp: boolean, events: BlackjackEvent[]): Table {
    const { card, table: next } = this.#draw(table);
    events.push({ type: 'CARD_DEALT', target: { kind: 'DEALER' }, card, faceUp });
    return { ...next, dealer: { ...next.dealer, cards: [...next.dealer.cards, card] } };
  }
}
