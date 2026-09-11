import {
  EngineError,
  ZERO_CHIPS,
  addChips,
  applyRatioFloor,
  chips,
  err,
  invariant,
  isChips,
  ok,
  subtractChips,
  type ChipRange,
  type Chips,
  type Ratio,
  type Result,
} from '../../core/index.js';
import type { BlackjackRules } from '../rules.js';
import type { HandOutcome } from '../types/hand.js';
import type { BlackjackSeat } from '../types/state.js';

const HALF: Ratio = { numerator: 1, denominator: 2 };
const INSURANCE_PAYOUT: Ratio = { numerator: 2, denominator: 1 };

export interface StakeReservation {
  readonly seat: BlackjackSeat;
  readonly stake: Chips;
}

/**
 * Mouvements de jetons du Blackjack, tous immuables et vérifiés.
 * Invariant : bankroll + pendingBet + Σ mises des mains + assurance reste constant jusqu'au règlement.
 * La légalité de jeu (Double Down sur 2 cartes, paire splittable…) relève de l'évaluateur (Étape 3) et du controller (Étape 4).
 */
export class BlackjackBetManager {
  readonly #rules: BlackjackRules;

  constructor(rules: BlackjackRules) {
    this.#rules = rules;
  }

  /**
   * Montant ADDITIONNEL posable : PLACE_BET est cumulatif, comme des jetons ajoutés un à un sur le tapis.
   * La première mise doit atteindre minBet ; le total ne peut dépasser maxBet ni le bankroll.
   */
  betRange(seat: BlackjackSeat): ChipRange | null {
    const min = seat.pendingBet === 0 ? this.#rules.minBet : chips(1);
    const max = Math.min(this.#rules.maxBet - seat.pendingBet, seat.bankroll);
    return max >= min ? { min, max: chips(max) } : null;
  }

  placeBet(seat: BlackjackSeat, amount: number): Result<BlackjackSeat> {
    if (!isChips(amount) || amount === 0) {
      return err(new EngineError('INVALID_AMOUNT', `Mise invalide : ${amount}`));
    }
    if (amount > seat.bankroll) {
      return err(
        new EngineError('INSUFFICIENT_FUNDS', `Mise de ${amount} supérieure au bankroll`, { bankroll: seat.bankroll }),
      );
    }
    const range = this.betRange(seat);
    if (range === null || amount < range.min || amount > range.max) {
      return err(
        new EngineError('BET_OUT_OF_LIMITS', `Mise de ${amount} hors des limites de table`, {
          pendingBet: seat.pendingBet,
          minBet: this.#rules.minBet,
          maxBet: this.#rules.maxBet,
        }),
      );
    }
    return ok({
      ...seat,
      bankroll: subtractChips(seat.bankroll, amount),
      pendingBet: addChips(seat.pendingBet, amount),
    });
  }

  clearBet(seat: BlackjackSeat): BlackjackSeat {
    return { ...seat, bankroll: addChips(seat.bankroll, seat.pendingBet), pendingBet: ZERO_CHIPS };
  }

  /** Débite une mise égale à celle de la main visée : complément d'un Double Down ou mise de la main créée par un Split. */
  reserveHandStake(seat: BlackjackSeat, handIndex: number): Result<StakeReservation> {
    const hand = seat.hands[handIndex];
    if (hand === undefined) {
      return err(new EngineError('ILLEGAL_ACTION', `Main ${handIndex} inexistante`));
    }
    if (seat.bankroll < hand.bet) {
      return err(
        new EngineError('INSUFFICIENT_FUNDS', `${hand.bet} jetons requis`, { bankroll: seat.bankroll, required: hand.bet }),
      );
    }
    return ok({ seat: { ...seat, bankroll: subtractChips(seat.bankroll, hand.bet) }, stake: hand.bet });
  }

  doubleDown(seat: BlackjackSeat, handIndex: number): Result<BlackjackSeat> {
    const reservation = this.reserveHandStake(seat, handIndex);
    if (!reservation.ok) return reservation;

    const { seat: debited, stake } = reservation.value;
    const hand = debited.hands[handIndex];
    invariant(hand !== undefined, `Main ${handIndex} disparue pendant le Double Down`);
    return ok({ ...debited, hands: debited.hands.with(handIndex, { ...hand, bet: addChips(hand.bet, stake) }) });
  }

  /** Assurance = moitié (arrondie à l'inférieur) de la mise initiale. */
  insuranceStake(seat: BlackjackSeat): Chips {
    const initialHand = seat.hands[0];
    return initialHand === undefined ? ZERO_CHIPS : applyRatioFloor(initialHand.bet, HALF);
  }

  takeInsurance(seat: BlackjackSeat): Result<BlackjackSeat> {
    if (!this.#rules.insurance || seat.insurance.status !== 'PENDING') {
      return err(new EngineError('ILLEGAL_ACTION', "L'assurance n'est pas proposée à ce siège"));
    }
    const stake = this.insuranceStake(seat);
    if (stake === 0) {
      return err(new EngineError('ILLEGAL_ACTION', 'Mise initiale trop faible pour être assurée'));
    }
    if (seat.bankroll < stake) {
      return err(new EngineError('INSUFFICIENT_FUNDS', `${stake} jetons requis pour l'assurance`));
    }
    const insured: BlackjackSeat = {
      ...seat,
      bankroll: subtractChips(seat.bankroll, stake),
      insurance: { status: 'TAKEN', stake },
    };
    return ok(insured);
  }

  declineInsurance(seat: BlackjackSeat): Result<BlackjackSeat> {
    if (seat.insurance.status !== 'PENDING') {
      return err(new EngineError('ILLEGAL_ACTION', "Aucune décision d'assurance en attente pour ce siège"));
    }
    const declined: BlackjackSeat = { ...seat, insurance: { status: 'DECLINED' } };
    return ok(declined);
  }

  /** Montant rendu au bankroll, mise incluse. Tous les arrondis se font à l'unité inférieure. */
  returnedFor(outcome: HandOutcome, stake: Chips): Chips {
    switch (outcome) {
      case 'BLACKJACK':
        return addChips(stake, applyRatioFloor(stake, this.#rules.blackjackPayout));
      case 'WIN':
        return addChips(stake, stake);
      case 'PUSH':
        return stake;
      case 'LOSS':
        return ZERO_CHIPS;
      case 'SURRENDER':
        return applyRatioFloor(stake, HALF);
    }
  }

  insuranceReturned(stake: Chips, dealerHasBlackjack: boolean): Chips {
    return dealerHasBlackjack ? addChips(stake, applyRatioFloor(stake, INSURANCE_PAYOUT)) : ZERO_CHIPS;
  }

  credit(seat: BlackjackSeat, amount: Chips): BlackjackSeat {
    return { ...seat, bankroll: addChips(seat.bankroll, amount) };
  }
}
