import {
  EngineError,
  InvariantViolation,
  ZERO_CHIPS,
  addChips,
  burnCard,
  chips,
  clockwiseFrom,
  createShoe,
  drawCard,
  drawCards,
  err,
  invariant,
  isChips,
  ok,
  type Card,
  type Chips,
  type PlayerId,
  type RandomSource,
  type Result,
  type SeatIndex,
  type ShoeState,
  type Transition,
} from '../../core/index.js';
import { HoldemBetManager } from '../betting/bet-manager.js';
import { awardPots, buildPots, contributionsOf, returnUncalledBet } from '../betting/pots.js';
import { evaluateHand } from '../evaluation/hand-evaluator.js';
import { validateHoldemRules, type HoldemRules } from '../rules.js';
import {
  HOLDEM_COMMAND_PHASES,
  type HoldemCommand,
  type PokerBettingAction,
  type PokerTableAction,
} from '../types/actions.js';
import type { HoldemEngine, HoldemTableView, PokerLegalActions, PokerSeatView } from '../types/contract.js';
import type { HoldemEvent, HoldemViewEvent } from '../types/events.js';
import type { EvaluatedHand, HoleCards } from '../types/hand-rank.js';
import type { Pot, PotAward } from '../types/pot.js';
import {
  STREETS,
  type BettingRound,
  type BlindPositions,
  type Board,
  type HandCompletePhase,
  type HandInProgress,
  type HoldemHandOutcome,
  type HoldemState,
  type PokerSeat,
  type ShowdownEntry,
  type Street,
  type WaitingPhase,
} from '../types/state.js';

type Step = Result<Transition<HoldemState, HoldemEvent>>;
type Seats = readonly (PokerSeat | null)[];
type SitDown = Extract<PokerTableAction, { readonly type: 'SIT_DOWN' }>;
type SeatToggle = Exclude<PokerTableAction, { readonly type: 'SIT_DOWN' }>;
type ForcedBetKind = 'SMALL_BLIND' | 'BIG_BLIND' | 'ANTE';

/** Copie de travail d'une main en cours, locale à un `apply` : l'état reçu n'est jamais muté. */
interface Hand {
  readonly rules: HoldemRules;
  readonly handNumber: number;
  readonly buttonSeat: SeatIndex;
  readonly blinds: BlindPositions;
  seats: (PokerSeat | null)[];
  deck: ShoeState;
  street: Street;
  board: Board;
  round: BettingRound;
}

function done(state: HoldemState, events: readonly HoldemEvent[] = []): Step {
  return ok({ state, events });
}

export function isHandInProgress(state: HoldemState): state is HandInProgress {
  return state.phase !== 'WAITING' && state.phase !== 'HAND_COMPLETE';
}

function findSeat(seats: Seats, playerId: PlayerId): PokerSeat | null {
  return seats.find((seat) => seat?.player.id === playerId) ?? null;
}

function setSeat<S extends HoldemState>(state: S, index: SeatIndex, seat: PokerSeat | null): S {
  return { ...state, seats: state.seats.with(index, seat) };
}

const isContender = (seat: PokerSeat | null): seat is PokerSeat =>
  seat !== null && (seat.status === 'IN_HAND' || seat.status === 'ALL_IN');

const canBet = (seat: PokerSeat | null): seat is PokerSeat =>
  seat !== null && seat.status === 'IN_HAND' && seat.stack > 0;

function needsToAct(seat: PokerSeat | null, round: BettingRound): boolean {
  return canBet(seat) && (!seat.hasActed || seat.streetBet < round.currentBet);
}

function opponentsWithChips(seats: Seats, except: SeatIndex): number {
  return seats.filter((seat) => canBet(seat) && seat.seatIndex !== except).length;
}

function toBoard(cards: readonly Card[]): Board {
  const [a, b, c, d, e] = cards;
  switch (cards.length) {
    case 0:
      return [];
    case 3:
      invariant(a !== undefined && b !== undefined && c !== undefined, 'Flop incomplet');
      return [a, b, c];
    case 4:
      invariant(a !== undefined && b !== undefined && c !== undefined && d !== undefined, 'Turn incomplet');
      return [a, b, c, d];
    case 5:
      invariant(
        a !== undefined && b !== undefined && c !== undefined && d !== undefined && e !== undefined,
        'River incomplète',
      );
      return [a, b, c, d, e];
    default:
      throw new InvariantViolation(`Un board de ${cards.length} cartes est impossible`);
  }
}

/** Reconstruit la variante typée de la street : le nombre de cartes du board est revérifié. */
function toState(hand: Hand): HandInProgress {
  const common = {
    rules: hand.rules,
    handNumber: hand.handNumber,
    seats: hand.seats,
    buttonSeat: hand.buttonSeat,
    blinds: hand.blinds,
    deck: hand.deck,
    betting: hand.round,
  };
  const { board } = hand;
  switch (hand.street) {
    case 'PREFLOP':
      invariant(board.length === 0, 'Aucune carte commune au préflop');
      return { ...common, phase: 'PREFLOP', board };
    case 'FLOP':
      invariant(board.length === 3, 'Le flop compte 3 cartes');
      return { ...common, phase: 'FLOP', board };
    case 'TURN':
      invariant(board.length === 4, 'Le turn compte 4 cartes');
      return { ...common, phase: 'TURN', board };
    case 'RIVER':
      invariant(board.length === 5, 'La river compte 5 cartes');
      return { ...common, phase: 'RIVER', board };
  }
}

function fromState(state: HandInProgress): Hand {
  return {
    rules: state.rules,
    handNumber: state.handNumber,
    buttonSeat: state.buttonSeat,
    blinds: state.blinds,
    seats: [...state.seats],
    deck: state.deck,
    street: state.phase,
    board: state.board,
    round: state.betting,
  };
}

function creditAwards(seats: Seats, awards: readonly PotAward[]): (PokerSeat | null)[] {
  const shares = awards.flatMap((award) => award.shares);
  return seats.map((seat) => {
    if (seat === null) return null;
    const won = shares
      .filter((share) => share.seatIndex === seat.seatIndex)
      .reduce<Chips>((total, share) => addChips(total, share.amount), ZERO_CHIPS);
    return won === 0 ? seat : { ...seat, stack: addChips(seat.stack, won) };
  });
}

/** Pots affichés pendant une street : uniquement les contributions des streets précédentes. */
function potsBeforeStreet(seats: Seats): Pot[] {
  return buildPots(
    contributionsOf(seats).map((contribution) => ({
      ...contribution,
      amount: chips(contribution.amount - (seats[contribution.seatIndex]?.streetBet ?? 0)),
    })),
  );
}

/**
 * Game Controller du Texas Hold'em No-Limit : blindes, tours d'enchères, streets, runout des all-in, showdown et side pots.
 * Pur à l'aléa injecté près : aucune mutation de l'état reçu.
 */
export class HoldemController implements HoldemEngine {
  readonly #rng: RandomSource;

  constructor(rng: RandomSource) {
    this.#rng = rng;
  }

  createTable(rules: HoldemRules): Result<WaitingPhase> {
    const validated = validateHoldemRules(rules);
    if (!validated.ok) return validated;
    const table: WaitingPhase = {
      phase: 'WAITING',
      rules,
      handNumber: 0,
      seats: Array.from({ length: rules.seatCount }, () => null),
      buttonSeat: null,
    };
    return ok(table);
  }

  apply(state: HoldemState, command: HoldemCommand): Step {
    const allowedPhases: readonly string[] = HOLDEM_COMMAND_PHASES[command.type];
    if (!allowedPhases.includes(state.phase)) {
      return err(new EngineError('ILLEGAL_PHASE', `${command.type} impossible pendant la phase ${state.phase}`));
    }
    try {
      switch (command.type) {
        case 'START_HAND':
          invariant(state.phase === 'WAITING' || state.phase === 'HAND_COMPLETE', 'START_HAND hors phase');
          return this.#startHand(state);
        case 'SIT_DOWN':
          return this.#sitDown(state, command);
        case 'LEAVE_SEAT':
        case 'SIT_OUT':
        case 'SIT_IN':
          return this.#toggleSeat(state, command);
        default:
          invariant(isHandInProgress(state), "Action de mise en dehors d'une main");
          return this.#bettingAction(state, command);
      }
    } catch (error) {
      if (error instanceof EngineError) return err(error);
      throw error;
    }
  }

  legalActions(state: HoldemState, playerId: PlayerId): PokerLegalActions | null {
    if (!isHandInProgress(state)) return null;
    const seat = findSeat(state.seats, playerId);
    if (seat === null) return null;
    return new HoldemBetManager(state.rules).legalActions(seat, state.betting, {
      opponentsWithChips: opponentsWithChips(state.seats, seat.seatIndex),
    });
  }

  project(state: HoldemState, viewer: PlayerId | null): HoldemTableView {
    const viewerSeat = viewer === null ? null : (findSeat(state.seats, viewer)?.seatIndex ?? null);
    const shownAtShowdown = new Set<SeatIndex>(
      state.phase === 'HAND_COMPLETE' && state.outcome.kind === 'SHOWDOWN'
        ? state.outcome.showdown.map((entry) => entry.seatIndex)
        : [],
    );

    const seats = state.seats.map((seat): PokerSeatView | null => {
      if (seat === null) return null;
      const { holeCards, ...publicInfo } = seat;
      if (holeCards === null) return { ...publicInfo, holeCards: null };
      const visible = seat.seatIndex === viewerSeat || shownAtShowdown.has(seat.seatIndex);
      return {
        ...publicInfo,
        holeCards: visible
          ? [
              { faceUp: true, card: holeCards[0] },
              { faceUp: true, card: holeCards[1] },
            ]
          : [{ faceUp: false }, { faceUp: false }],
      };
    });

    return {
      phase: state.phase,
      handNumber: state.handNumber,
      rules: state.rules,
      viewer,
      viewerSeat,
      buttonSeat: state.buttonSeat,
      seats,
      board: state.phase === 'WAITING' ? [] : state.board,
      pots: isHandInProgress(state) ? potsBeforeStreet(state.seats) : [],
      toAct: isHandInProgress(state) ? state.betting.toAct : null,
      legalActions: viewer === null ? null : this.legalActions(state, viewer),
      outcome: state.phase === 'HAND_COMPLETE' ? state.outcome : null,
    };
  }

  projectEvent(event: HoldemEvent, viewer: PlayerId | null): HoldemViewEvent {
    if (event.type !== 'HOLE_CARDS_DEALT') return event;
    const [first, second] = event.cards;
    const visible = viewer !== null && event.playerId === viewer;
    return {
      ...event,
      cards: visible
        ? [
            { faceUp: true, card: first },
            { faceUp: true, card: second },
          ]
        : [{ faceUp: false }, { faceUp: false }],
    };
  }

  // ─── Sièges ────────────────────────────────────────────────────────────────

  #sitDown(state: HoldemState, command: SitDown): Step {
    const { seatIndex, buyIn, playerId } = command;
    const { rules } = state;
    if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= rules.seatCount) {
      return err(new EngineError('SEAT_OUT_OF_RANGE', `Siège ${seatIndex} inexistant`));
    }
    if (state.seats[seatIndex] !== null) {
      return err(new EngineError('SEAT_TAKEN', `Le siège ${seatIndex} est occupé`));
    }
    if (findSeat(state.seats, playerId) !== null) {
      return err(new EngineError('ALREADY_SEATED', 'Ce joueur est déjà assis à la table'));
    }
    if (!isChips(buyIn) || buyIn < rules.minBuyIn || buyIn > rules.maxBuyIn) {
      return err(
        new EngineError('BET_OUT_OF_LIMITS', `La cave doit être comprise entre ${rules.minBuyIn} et ${rules.maxBuyIn}`),
      );
    }
    // Arrivé en cours de main, le joueur attend la suivante sans cartes.
    const seat: PokerSeat = {
      seatIndex,
      player: { id: playerId, displayName: command.displayName.trim() || `Joueur ${seatIndex + 1}` },
      stack: buyIn,
      status: isHandInProgress(state) ? 'FOLDED' : 'IN_HAND',
      holeCards: null,
      streetBet: ZERO_CHIPS,
      totalCommitted: ZERO_CHIPS,
      hasActed: false,
      lastAction: null,
    };
    return done(setSeat(state, seatIndex, seat), [{ type: 'PLAYER_SAT_DOWN', seatIndex, playerId, stack: buyIn }]);
  }

  #toggleSeat(state: HoldemState, command: SeatToggle): Step {
    const seat = findSeat(state.seats, command.playerId);
    if (seat === null) {
      return err(new EngineError('UNKNOWN_PLAYER', "Ce joueur n'est pas assis à la table"));
    }
    if (isHandInProgress(state)) {
      return err(new EngineError('ILLEGAL_ACTION', `${command.type} n'est possible qu'entre deux mains`));
    }
    const { seatIndex } = seat;
    switch (command.type) {
      case 'LEAVE_SEAT':
        return done(setSeat(state, seatIndex, null), [{ type: 'PLAYER_LEFT', seatIndex, playerId: seat.player.id }]);
      case 'SIT_OUT':
        return done(setSeat(state, seatIndex, { ...seat, status: 'SITTING_OUT' }), [{ type: 'PLAYER_SAT_OUT', seatIndex }]);
      case 'SIT_IN':
        if (seat.status !== 'SITTING_OUT' || seat.stack === 0) {
          return err(new EngineError('ILLEGAL_ACTION', 'Le joueur doit être en pause et disposer de jetons'));
        }
        return done(setSeat(state, seatIndex, { ...seat, status: 'IN_HAND' }), [{ type: 'PLAYER_SAT_IN', seatIndex }]);
    }
  }

  // ─── Début de main ─────────────────────────────────────────────────────────

  #startHand(state: WaitingPhase | HandCompletePhase): Step {
    const { rules } = state;
    const participants = state.seats.filter(
      (seat): seat is PokerSeat => seat !== null && seat.status !== 'SITTING_OUT' && seat.stack > 0,
    );
    const [firstParticipant] = participants;
    if (firstParticipant === undefined || participants.length < Math.max(2, rules.minPlayersToStart)) {
      return err(new EngineError('NOT_ENOUGH_PLAYERS', 'Pas assez de joueurs avec des jetons pour démarrer une main'));
    }

    const inHand = new Set(participants.map((seat) => seat.seatIndex));
    const around = (from: SeatIndex): SeatIndex[] =>
      clockwiseFrom(from, rules.seatCount).filter((seatIndex) => inHand.has(seatIndex));
    const nextAfter = (from: SeatIndex): SeatIndex => {
      const [next] = around(from);
      invariant(next !== undefined, 'Aucun joueur autour de la table');
      return next;
    };

    const buttonSeat = state.buttonSeat === null ? firstParticipant.seatIndex : nextAfter(state.buttonSeat);
    // Heads-up : le bouton poste la small blind.
    const smallBlind = participants.length === 2 ? buttonSeat : nextAfter(buttonSeat);
    const blinds: BlindPositions = { smallBlind, bigBlind: nextAfter(smallBlind) };

    const deck = createShoe({ deckCount: 1, penetration: 1 }, this.#rng);
    if (!deck.ok) throw deck.error;

    const hand: Hand = {
      rules,
      handNumber: state.handNumber + 1,
      buttonSeat,
      blinds,
      seats: state.seats.map(
        (seat): PokerSeat | null =>
          seat === null
            ? null
            : {
                ...seat,
                status: inHand.has(seat.seatIndex) ? 'IN_HAND' : 'SITTING_OUT',
                holeCards: null,
                streetBet: ZERO_CHIPS,
                totalCommitted: ZERO_CHIPS,
                hasActed: false,
                lastAction: null,
              },
      ),
      deck: deck.value,
      street: 'PREFLOP',
      board: [],
      round: new HoldemBetManager(rules).openRound('PREFLOP', blinds.bigBlind),
    };
    const events: HoldemEvent[] = [
      { type: 'HAND_STARTED', handNumber: hand.handNumber, buttonSeat, blinds },
      { type: 'DECK_SHUFFLED' },
    ];

    const dealOrder = around(buttonSeat);
    if (rules.ante > 0) {
      for (const seatIndex of dealOrder) this.#postForcedBet(hand, seatIndex, 'ANTE', rules.ante, events);
    }
    this.#postForcedBet(hand, blinds.smallBlind, 'SMALL_BLIND', rules.smallBlind, events);
    this.#postForcedBet(hand, blinds.bigBlind, 'BIG_BLIND', rules.bigBlind, events);

    // Une carte à la fois, en commençant à gauche du bouton.
    const dealt = new Map<SeatIndex, Card[]>();
    for (let pass = 0; pass < 2; pass += 1) {
      for (const seatIndex of dealOrder) {
        dealt.set(seatIndex, [...(dealt.get(seatIndex) ?? []), this.#draw(hand)]);
      }
    }
    for (const seatIndex of dealOrder) {
      const [first, second] = dealt.get(seatIndex) ?? [];
      const seat = hand.seats[seatIndex];
      invariant(first !== undefined && second !== undefined && seat !== null && seat !== undefined, 'Donne incomplète');
      const holeCards: HoleCards = [first, second];
      hand.seats = hand.seats.with(seatIndex, { ...seat, holeCards });
      events.push({ type: 'HOLE_CARDS_DEALT', seatIndex, playerId: seat.player.id, cards: holeCards });
    }

    return done(this.#openAction(hand, blinds.bigBlind, events), events);
  }

  #postForcedBet(hand: Hand, seatIndex: SeatIndex, kind: ForcedBetKind, amount: Chips, events: HoldemEvent[]): void {
    const seat = hand.seats[seatIndex];
    if (seat === null || seat === undefined || seat.status !== 'IN_HAND' || seat.stack === 0) return;
    const bets = new HoldemBetManager(hand.rules);
    const forced = kind === 'ANTE' ? bets.postAnte(seat, amount) : bets.postBlind(seat, amount);
    hand.seats = hand.seats.with(seatIndex, forced.seat);
    events.push({ type: 'FORCED_BET_POSTED', seatIndex, kind, amount: forced.posted, isAllIn: forced.isAllIn });
  }

  // ─── Enchères ──────────────────────────────────────────────────────────────

  #bettingAction(state: HandInProgress, command: PokerBettingAction): Step {
    const hand = fromState(state);
    const seat = findSeat(hand.seats, command.playerId);
    if (seat === null) {
      return err(new EngineError('UNKNOWN_PLAYER', "Ce joueur n'est pas assis à la table"));
    }
    const resolved = new HoldemBetManager(hand.rules).apply(seat, hand.round, command, {
      opponentsWithChips: opponentsWithChips(hand.seats, seat.seatIndex),
    });
    if (!resolved.ok) return resolved;

    const { seat: acted, round, added, isAllIn } = resolved.value;
    hand.seats = hand.seats.with(seat.seatIndex, acted);
    hand.round = round;
    const events: HoldemEvent[] = [
      { type: 'PLAYER_ACTED', seatIndex: seat.seatIndex, action: command.type, amount: added, streetBet: acted.streetBet, isAllIn },
    ];

    const contenders = hand.seats.filter(isContender);
    const [lastStanding] = contenders;
    const next =
      contenders.length === 1 && lastStanding !== undefined
        ? this.#finishUncontested(hand, lastStanding.seatIndex, events)
        : this.#openAction(hand, seat.seatIndex, events);
    return done(next, events);
  }

  /** Donne la parole au prochain joueur concerné, ou clôt la street si plus personne n'a à agir. */
  #openAction(hand: Hand, from: SeatIndex, events: HoldemEvent[]): HoldemState {
    const next = this.#nextToAct(hand, from);
    if (next === null) return this.#endStreet(hand, events);
    hand.round = { ...hand.round, toAct: next };
    events.push({ type: 'TURN_STARTED', seatIndex: next });
    return toState(hand);
  }

  #nextToAct(hand: Hand, from: SeatIndex): SeatIndex | null {
    const bettors = hand.seats.filter(canBet);
    const [onlyBettor] = bettors;
    // Enchères closes : personne ne peut miser, ou un seul joueur a des jetons et a déjà égalisé.
    if (bettors.length === 0 || (bettors.length === 1 && onlyBettor !== undefined && onlyBettor.streetBet >= hand.round.currentBet)) {
      return null;
    }
    return clockwiseFrom(from, hand.rules.seatCount).find((seatIndex) => needsToAct(hand.seats[seatIndex] ?? null, hand.round)) ?? null;
  }

  #endStreet(hand: Hand, events: HoldemEvent[]): HoldemState {
    const uncalled = returnUncalledBet(hand.seats);
    hand.seats = uncalled.seats;
    if (uncalled.returned !== null) events.push({ type: 'UNCALLED_BET_RETURNED', ...uncalled.returned });
    events.push({ type: 'POTS_UPDATED', pots: buildPots(contributionsOf(hand.seats)) });

    // S'il reste moins de deux joueurs capables de miser, le board est déroulé jusqu'au showdown.
    while (hand.street !== 'RIVER') {
      this.#dealNextStreet(hand, events);
      const next = this.#nextToAct(hand, hand.buttonSeat);
      if (next !== null) {
        hand.round = { ...hand.round, toAct: next };
        events.push({ type: 'TURN_STARTED', seatIndex: next });
        return toState(hand);
      }
    }
    return this.#showdown(hand, events);
  }

  #dealNextStreet(hand: Hand, events: HoldemEvent[]): void {
    const street = STREETS[STREETS.indexOf(hand.street) + 1];
    invariant(street !== undefined && street !== 'PREFLOP', `Aucune street après ${hand.street}`);

    const burned = burnCard(hand.deck);
    if (!burned.ok) throw burned.error;
    const drawn = drawCards(burned.value, street === 'FLOP' ? 3 : 1);
    if (!drawn.ok) throw drawn.error;

    const bets = new HoldemBetManager(hand.rules);
    hand.deck = drawn.value.shoe;
    hand.board = toBoard([...hand.board, ...drawn.value.cards]);
    hand.street = street;
    hand.seats = bets.resetSeatsForStreet(hand.seats);
    hand.round = bets.openRound(street, hand.buttonSeat);
    events.push({ type: 'STREET_DEALT', street, cards: drawn.value.cards, board: hand.board });
  }

  // ─── Fin de main ───────────────────────────────────────────────────────────

  #showdown(hand: Hand, events: HoldemEvent[]): HandCompletePhase {
    const { board } = hand;
    invariant(board.length === 5, 'Showdown sans board complet');

    const showdown = hand.seats.filter(isContender).map((seat): ShowdownEntry => {
      invariant(seat.holeCards !== null, `Le siège ${seat.seatIndex} n'a pas de cartes`);
      return { seatIndex: seat.seatIndex, holeCards: seat.holeCards, hand: evaluateHand([...seat.holeCards, ...board]) };
    });
    events.push({ type: 'SHOWDOWN', entries: showdown });

    const hands = new Map<SeatIndex, EvaluatedHand>(
      showdown.map((entry): [SeatIndex, EvaluatedHand] => [entry.seatIndex, entry.hand]),
    );
    const awards = this.#distributePots(hand, hands, events);
    return this.#complete(hand, { kind: 'SHOWDOWN', showdown, awards }, events);
  }

  #finishUncontested(hand: Hand, winner: SeatIndex, events: HoldemEvent[]): HandCompletePhase {
    const uncalled = returnUncalledBet(hand.seats);
    hand.seats = uncalled.seats;
    if (uncalled.returned !== null) events.push({ type: 'UNCALLED_BET_RETURNED', ...uncalled.returned });
    const awards = this.#distributePots(hand, new Map(), events);
    return this.#complete(hand, { kind: 'UNCONTESTED', winner, awards }, events);
  }

  #distributePots(hand: Hand, hands: ReadonlyMap<SeatIndex, EvaluatedHand>, events: HoldemEvent[]): PotAward[] {
    const oddChipOrder = clockwiseFrom(hand.buttonSeat, hand.rules.seatCount);
    const awards = awardPots(buildPots(contributionsOf(hand.seats)), hands, oddChipOrder);
    hand.seats = creditAwards(hand.seats, awards);
    for (const award of awards) events.push({ type: 'POT_AWARDED', award });
    return awards;
  }

  #complete(hand: Hand, outcome: HoldemHandOutcome, events: HoldemEvent[]): HandCompletePhase {
    events.push({ type: 'HAND_ENDED', handNumber: hand.handNumber, outcome });
    return {
      phase: 'HAND_COMPLETE',
      rules: hand.rules,
      handNumber: hand.handNumber,
      seats: hand.seats,
      buttonSeat: hand.buttonSeat,
      board: hand.board,
      outcome,
    };
  }

  #draw(hand: Hand): Card {
    const drawn = drawCard(hand.deck);
    if (!drawn.ok) throw drawn.error;
    hand.deck = drawn.value.shoe;
    return drawn.value.card;
  }
}
