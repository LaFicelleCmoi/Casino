import {
  EngineError,
  ZERO_CHIPS,
  addChips,
  chips,
  err,
  invariant,
  isChips,
  minChips,
  ok,
  subtractChips,
  type ChipRange,
  type Chips,
  type Result,
  type SeatIndex,
} from '../../core/index.js';
import type { HoldemRules } from '../rules.js';
import type { PokerBettingAction, PokerBettingActionType } from '../types/actions.js';
import type { PokerLegalActions } from '../types/contract.js';
import type { BettingRound, PokerSeat, Street } from '../types/state.js';

export interface BettingContext {
  /** Adversaires encore capables de répondre à une mise (statut IN_HAND et stack > 0). */
  readonly opponentsWithChips: number;
}

export interface BettingResolution {
  readonly seat: PokerSeat;
  /** `toAct` n'est pas modifié : l'ordre de parole est la responsabilité du controller (Étape 4). */
  readonly round: BettingRound;
  readonly added: Chips;
  readonly isAllIn: boolean;
  /** true si la mise a augmenté d'au moins une relance complète. */
  readonly isFullRaise: boolean;
}

export interface ForcedBet {
  readonly seat: PokerSeat;
  readonly posted: Chips;
  readonly isAllIn: boolean;
}

function isWithin(value: number, range: ChipRange): value is Chips {
  return isChips(value) && value >= range.min && value <= range.max;
}

function illegal(message: string, details?: Readonly<Record<string, unknown>>): Result<never> {
  return err(new EngineError('ILLEGAL_ACTION', message, details));
}

function outOfLimits(value: number, range: ChipRange): Result<never> {
  return err(
    new EngineError('BET_OUT_OF_LIMITS', `Montant ${value} hors de [${range.min}, ${range.max}]`, {
      value,
      min: range.min,
      max: range.max,
    }),
  );
}

/** Gestionnaire des mises No-Limit : actions légales, validation des montants, relances complètes et all-in courts. */
export class HoldemBetManager {
  readonly #rules: HoldemRules;

  constructor(rules: HoldemRules) {
    this.#rules = rules;
  }

  /** Préflop, la mise à suivre est la big blind nominale, même si la big blind a été postée short all-in. */
  openRound(street: Street, firstToAct: SeatIndex): BettingRound {
    return {
      toAct: firstToAct,
      currentBet: street === 'PREFLOP' ? this.#rules.bigBlind : ZERO_CHIPS,
      minRaise: this.#rules.bigBlind,
      lastAggressor: null,
    };
  }

  resetSeatsForStreet(seats: readonly (PokerSeat | null)[]): (PokerSeat | null)[] {
    return seats.map((seat) =>
      seat === null
        ? null
        : {
            ...seat,
            streetBet: ZERO_CHIPS,
            hasActed: false,
            lastAction: seat.status === 'FOLDED' ? seat.lastAction : null,
          },
    );
  }

  /** Blinde : compte dans la mise à suivre. Plafonnée au stack (short all-in). */
  postBlind(seat: PokerSeat, amount: Chips): ForcedBet {
    return this.#force(seat, amount, true);
  }

  /** Ante : argent mort, alimente le pot sans compter dans la mise à suivre. */
  postAnte(seat: PokerSeat, amount: Chips): ForcedBet {
    return this.#force(seat, amount, false);
  }

  /** null si ce siège ne peut pas agir maintenant (pas son tour, foldé, all-in). */
  legalActions(seat: PokerSeat, round: BettingRound, context: BettingContext): PokerLegalActions | null {
    if (seat.status !== 'IN_HAND' || seat.stack === 0 || round.toAct !== seat.seatIndex) {
      return null;
    }
    const toCall = subtractChips(round.currentBet, seat.streetBet);
    const maxTotal = addChips(seat.streetBet, seat.stack);
    const minRaiseTo = addChips(round.currentBet, round.minRaise);

    // Augmenter la mise n'a de sens que si quelqu'un peut encore répondre, et suppose le droit de relance.
    const canIncrease =
      context.opponentsWithChips > 0 &&
      maxTotal > round.currentBet &&
      (round.currentBet === 0 || this.#hasRaiseRight(seat, round));

    return {
      canFold: true,
      canCheck: toCall === 0,
      callAmount: toCall > 0 ? minChips(toCall, seat.stack) : null,
      bet:
        canIncrease && round.currentBet === 0 && seat.stack >= this.#rules.bigBlind
          ? { min: this.#rules.bigBlind, max: seat.stack }
          : null,
      raise: canIncrease && round.currentBet > 0 && maxTotal >= minRaiseTo ? { min: minRaiseTo, max: maxTotal } : null,
      // All-in toujours permis s'il équivaut à un call ; sinon soumis au droit de relance.
      allInAmount: canIncrease || seat.stack <= toCall ? seat.stack : null,
    };
  }

  apply(
    seat: PokerSeat,
    round: BettingRound,
    action: PokerBettingAction,
    context: BettingContext,
  ): Result<BettingResolution> {
    if (action.playerId !== seat.player.id) {
      return err(new EngineError('NOT_YOUR_TURN', "L'action n'émane pas du joueur assis à ce siège"));
    }
    const legal = this.legalActions(seat, round, context);
    if (legal === null) {
      return err(new EngineError('NOT_YOUR_TURN', `Le siège ${seat.seatIndex} ne peut pas agir maintenant`));
    }

    switch (action.type) {
      case 'FOLD':
        return ok(this.#withoutChips(seat, round, 'FOLD'));
      case 'CHECK':
        return legal.canCheck
          ? ok(this.#withoutChips(seat, round, 'CHECK'))
          : illegal('Impossible de checker face à une mise', { callAmount: legal.callAmount });
      case 'CALL':
        return legal.callAmount === null
          ? illegal('Aucune mise à suivre : utilisez CHECK')
          : ok(this.#commit(seat, round, legal.callAmount, 'CALL'));
      case 'BET':
        if (legal.bet === null) return illegal('Ouverture impossible : une mise existe déjà ou le stack est trop court');
        return isWithin(action.amount, legal.bet)
          ? ok(this.#commit(seat, round, action.amount, 'BET'))
          : outOfLimits(action.amount, legal.bet);
      case 'RAISE':
        if (legal.raise === null) {
          return illegal('Relance impossible : action non rouverte, stack trop court ou aucun adversaire pour suivre');
        }
        return isWithin(action.raiseTo, legal.raise)
          ? ok(this.#commit(seat, round, subtractChips(action.raiseTo, seat.streetBet), 'RAISE'))
          : outOfLimits(action.raiseTo, legal.raise);
      case 'ALL_IN':
        return legal.allInAmount === null
          ? illegal('All-in impossible ici : seul un call est autorisé')
          : ok(this.#commit(seat, round, legal.allInAmount, 'ALL_IN'));
    }
  }

  /**
   * Règle TDA : droit de relance si le joueur n'a pas encore parlé, ou s'il fait face à au moins une relance complète
   * depuis sa dernière action. Un joueur actif qui a parlé avait égalisé : sa streetBet vaut la mise d'alors.
   */
  #hasRaiseRight(seat: PokerSeat, round: BettingRound): boolean {
    return !seat.hasActed || round.currentBet - seat.streetBet >= round.minRaise;
  }

  #commit(seat: PokerSeat, round: BettingRound, amount: Chips, action: PokerBettingActionType): BettingResolution {
    const stack = subtractChips(seat.stack, amount);
    const streetBet = addChips(seat.streetBet, amount);
    const isAllIn = stack === 0;
    const nextSeat: PokerSeat = {
      ...seat,
      stack,
      streetBet,
      totalCommitted: addChips(seat.totalCommitted, amount),
      status: isAllIn ? 'ALL_IN' : seat.status,
      hasActed: true,
      lastAction: action,
    };

    if (streetBet <= round.currentBet) {
      return { seat: nextSeat, round, added: amount, isAllIn, isFullRaise: false };
    }

    const increment = streetBet - round.currentBet;
    const isFullRaise = increment >= round.minRaise;
    const nextRound: BettingRound = {
      ...round,
      currentBet: streetBet,
      // Un all-in court élève la mise sans changer la taille de relance minimale.
      minRaise: isFullRaise ? chips(increment) : round.minRaise,
      lastAggressor: isFullRaise ? seat.seatIndex : round.lastAggressor,
    };
    return { seat: nextSeat, round: nextRound, added: amount, isAllIn, isFullRaise };
  }

  #withoutChips(seat: PokerSeat, round: BettingRound, action: 'FOLD' | 'CHECK'): BettingResolution {
    const nextSeat: PokerSeat = {
      ...seat,
      hasActed: true,
      lastAction: action,
      status: action === 'FOLD' ? 'FOLDED' : seat.status,
    };
    return { seat: nextSeat, round, added: ZERO_CHIPS, isAllIn: false, isFullRaise: false };
  }

  #force(seat: PokerSeat, amount: Chips, countsTowardCall: boolean): ForcedBet {
    invariant(seat.status === 'IN_HAND' && seat.stack > 0, `Le siège ${seat.seatIndex} ne peut pas poster de mise forcée`);
    const posted = minChips(amount, seat.stack);
    const stack = subtractChips(seat.stack, posted);
    const nextSeat: PokerSeat = {
      ...seat,
      stack,
      streetBet: countsTowardCall ? addChips(seat.streetBet, posted) : seat.streetBet,
      totalCommitted: addChips(seat.totalCommitted, posted),
      status: stack === 0 ? 'ALL_IN' : seat.status,
    };
    return { seat: nextSeat, posted, isAllIn: stack === 0 };
  }
}
