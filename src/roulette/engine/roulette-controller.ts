import {
  EngineError,
  addBigChips,
  err,
  invariant,
  isBigChips,
  ok,
  type PlayerId,
  type RandomSource,
  type Result,
  type SeatIndex,
  type Transition,
} from '../../core/index.js';
import { EUROPEAN_BET_CATALOG, type BetCatalog } from '../betting/bet-catalog.js';
import { RouletteBetManager } from '../betting/bet-manager.js';
import { PayoutEngine } from '../evaluation/payout-engine.js';
import { validateRouletteRules, type RouletteRules } from '../rules.js';
import {
  ROULETTE_COMMAND_PHASES,
  type RouletteCommand,
  type RoulettePlayerAction,
  type RoulettePlayerActionType,
} from '../types/actions.js';
import type { RouletteEngine, RouletteLegalActions, RouletteTableView } from '../types/contract.js';
import type { RouletteEvent } from '../types/events.js';
import type { SeatSettlement } from '../types/settlement.js';
import type {
  RouletteBettingPhase,
  RouletteNoMoreBetsPhase,
  RouletteResultPhase,
  RouletteSeat,
  RouletteState,
  RouletteTableBase,
} from '../types/state.js';
import { describeNumber } from '../wheel/pockets.js';
import { RouletteWheel } from '../wheel/roulette-wheel.js';

type Step = Result<Transition<RouletteState, RouletteEvent>>;
type SitDown = Extract<RouletteCommand, { readonly type: 'SIT_DOWN' }>;
type SeatCommand = Exclude<RoulettePlayerAction, { readonly type: 'SIT_DOWN' }>;

const NO_ACTIONS: RouletteLegalActions = { actions: [], betRange: null };

function done(state: RouletteState, events: readonly RouletteEvent[] = []): Step {
  return ok({ state, events });
}

/** Retire les champs propres à une phase (spin, settlements…) avant d'en construire une autre. */
function tableOf(state: RouletteState): RouletteTableBase {
  const { rules, roundNumber, seats, history } = state;
  return { rules, roundNumber, seats, history };
}

function findSeat(state: RouletteTableBase, playerId: PlayerId): RouletteSeat | null {
  return state.seats.find((seat) => seat?.player.id === playerId) ?? null;
}

function setSeat<S extends RouletteTableBase>(table: S, index: SeatIndex, seat: RouletteSeat | null): S {
  return { ...table, seats: table.seats.map((current, i) => (i === index ? seat : current)) };
}

/**
 * Game Controller de la Roulette Européenne : orchestre la state machine, délègue la validation des mises au
 * RouletteBetManager, le tirage à la RouletteWheel et le règlement au PayoutEngine.
 * Pur à l'aléa injecté près : aucune mutation de l'état reçu, aucune dépendance à une interface.
 */
export class RouletteController implements RouletteEngine {
  readonly catalog: BetCatalog;
  readonly #wheel: RouletteWheel;
  readonly #payouts: PayoutEngine;

  constructor(rng: RandomSource, catalog: BetCatalog = EUROPEAN_BET_CATALOG) {
    this.catalog = catalog;
    this.#wheel = new RouletteWheel(rng);
    this.#payouts = new PayoutEngine(catalog);
  }

  createTable(rules: RouletteRules): Result<RouletteBettingPhase> {
    const validated = validateRouletteRules(rules);
    if (!validated.ok) return validated;
    const table: RouletteBettingPhase = {
      phase: 'BETTING',
      rules,
      roundNumber: 0,
      seats: Array.from({ length: rules.seatCount }, () => null),
      history: [],
    };
    return ok(table);
  }

  apply(state: RouletteState, command: RouletteCommand): Step {
    const allowedPhases: readonly string[] = ROULETTE_COMMAND_PHASES[command.type];
    if (!allowedPhases.includes(state.phase)) {
      return err(new EngineError('ILLEGAL_PHASE', `${command.type} impossible pendant la phase ${state.phase}`));
    }
    try {
      switch (command.type) {
        case 'CLOSE_BETS': {
          const closed: RouletteNoMoreBetsPhase = { ...tableOf(state), phase: 'NO_MORE_BETS' };
          return done(closed, [{ type: 'BETS_CLOSED' }]);
        }
        case 'SPIN':
          invariant(state.phase === 'NO_MORE_BETS', 'La roue ne tourne qu’après « Rien ne va plus »');
          return this.#spin(state);
        case 'NEXT_ROUND': {
          const betting: RouletteBettingPhase = { ...tableOf(state), phase: 'BETTING' };
          return done(betting, [{ type: 'BETTING_OPENED' }]);
        }
        case 'SIT_DOWN':
          return this.#sitDown(state, command);
        default:
          return this.#seatCommand(state, command);
      }
    } catch (error) {
      // Seules les erreurs métier deviennent un Result ; un bug (InvariantViolation) reste une exception.
      if (error instanceof EngineError) return err(error);
      throw error;
    }
  }

  legalActions(state: RouletteState, playerId: PlayerId): RouletteLegalActions {
    const seat = findSeat(state, playerId);
    if (seat === null) {
      const canSit = state.phase !== 'NO_MORE_BETS' && state.seats.includes(null);
      return canSit ? { actions: ['SIT_DOWN'], betRange: null } : NO_ACTIONS;
    }

    switch (state.phase) {
      case 'BETTING': {
        const betRange = new RouletteBetManager(state.rules, this.catalog).betRange(seat);
        const actions: RoulettePlayerActionType[] = ['LEAVE_SEAT'];
        if (betRange !== null) actions.push('PLACE_BET');
        if (seat.bets.length > 0) actions.push('REMOVE_BET', 'CLEAR_BETS');
        return { actions, betRange };
      }
      case 'NO_MORE_BETS':
        return NO_ACTIONS;
      case 'RESULT':
        return { actions: ['LEAVE_SEAT'], betRange: null };
    }
  }

  project(state: RouletteState, viewer: PlayerId | null): RouletteTableView {
    return {
      phase: state.phase,
      roundNumber: state.roundNumber,
      rules: state.rules,
      viewer,
      viewerSeat: viewer === null ? null : (findSeat(state, viewer)?.seatIndex ?? null),
      seats: state.seats,
      history: state.history,
      lastSpin: state.phase === 'RESULT' ? { spin: state.spin, outcome: state.outcome } : null,
      settlements: state.phase === 'RESULT' ? state.settlements : [],
      legalActions: viewer === null ? NO_ACTIONS : this.legalActions(state, viewer),
    };
  }

  /** Rien n'est secret à la roulette : le numéro n'existe pas avant le lancer. */
  projectEvent(event: RouletteEvent, _viewer: PlayerId | null): RouletteEvent {
    return event;
  }

  // ─── Lancer et règlement ────────────────────────────────────────────────────

  #spin(state: RouletteNoMoreBetsPhase): Step {
    const spin = this.#wheel.spin();
    const outcome = describeNumber(spin.number);
    const roundNumber = state.roundNumber + 1;
    const events: RouletteEvent[] = [{ type: 'WHEEL_SPUN', spin, outcome }];
    const settlements: SeatSettlement[] = [];

    const seats = state.seats.map((seat): RouletteSeat | null => {
      if (seat === null || seat.bets.length === 0) return seat;
      const settled = this.#payouts.settle(seat.bets, spin.number);
      const bankroll = addBigChips(seat.bankroll, settled.totalReturned);
      const settlement: SeatSettlement = { ...settled, seatIndex: seat.seatIndex, playerId: seat.player.id, bankrollAfter: bankroll };
      settlements.push(settlement);
      events.push({ type: 'SEAT_SETTLED', settlement });
      return { ...seat, bankroll, bets: [] };
    });
    events.push({ type: 'ROUND_ENDED', roundNumber });

    const result: RouletteResultPhase = {
      phase: 'RESULT',
      rules: state.rules,
      roundNumber,
      seats,
      history: [spin.number, ...state.history].slice(0, state.rules.historySize),
      spin,
      outcome,
      settlements,
    };
    return done(result, events);
  }

  // ─── Sièges et mises ────────────────────────────────────────────────────────

  #sitDown(state: RouletteState, command: SitDown): Step {
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
    if (!isBigChips(buyIn) || buyIn === 0n) {
      return err(new EngineError('INVALID_AMOUNT', `Cave invalide : ${String(buyIn)}`));
    }
    const seat: RouletteSeat = {
      seatIndex,
      player: { id: playerId, displayName: command.displayName.trim() || `Joueur ${seatIndex + 1}` },
      bankroll: buyIn,
      bets: [],
    };
    return done(setSeat(state, seatIndex, seat), [{ type: 'PLAYER_SAT_DOWN', seatIndex, playerId, bankroll: buyIn }]);
  }

  #seatCommand(state: RouletteState, command: SeatCommand): Step {
    const seat = findSeat(state, command.playerId);
    if (seat === null) {
      return err(new EngineError('UNKNOWN_PLAYER', "Ce joueur n'est pas assis à la table"));
    }
    // PLACE_BET est validé par le moteur de mises, qui renvoie un code précis (position, fonds, plafonds).
    if (command.type !== 'PLACE_BET' && !this.legalActions(state, command.playerId).actions.includes(command.type)) {
      return err(new EngineError('ILLEGAL_ACTION', `${command.type} n'est pas autorisé maintenant`));
    }

    const bets = new RouletteBetManager(state.rules, this.catalog);
    const { seatIndex } = seat;
    switch (command.type) {
      case 'LEAVE_SEAT':
        // Les jetons encore posés (avant « Rien ne va plus ») repartent avec le joueur.
        return done(setSeat(state, seatIndex, null), [
          { type: 'PLAYER_LEFT', seatIndex, playerId: seat.player.id, bankroll: addBigChips(seat.bankroll, bets.totalStaked(seat)) },
        ]);
      case 'PLACE_BET': {
        const placed = bets.placeBet(seat, command.bet, command.amount);
        if (!placed.ok) return placed;
        const { seat: updated, bet, totalOnPosition } = placed.value;
        return done(setSeat(state, seatIndex, updated), [
          { type: 'BET_PLACED', seatIndex, betId: bet.id, amount: command.amount, totalOnPosition },
        ]);
      }
      case 'REMOVE_BET': {
        const removed = bets.removeBet(seat, command.betId);
        if (!removed.ok) return removed;
        return done(setSeat(state, seatIndex, removed.value.seat), [
          { type: 'BET_REMOVED', seatIndex, betId: command.betId, refunded: removed.value.refunded },
        ]);
      }
      case 'CLEAR_BETS': {
        const cleared = bets.clearBets(seat);
        return done(setSeat(state, seatIndex, cleared.seat), [{ type: 'BETS_CLEARED', seatIndex, refunded: cleared.refunded }]);
      }
    }
  }
}
