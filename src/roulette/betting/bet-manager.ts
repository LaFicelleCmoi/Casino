import {
  EngineError,
  addChips,
  chips,
  err,
  isChips,
  ok,
  subtractChips,
  sumChips,
  type ChipRange,
  type Chips,
  type Result,
} from '../../core/index.js';
import type { RouletteRules } from '../rules.js';
import type { BetDefinition, BetId, BetSelection, PlacedBet } from '../types/bet.js';
import type { RouletteSeat } from '../types/state.js';
import { EUROPEAN_BET_CATALOG, type BetCatalog } from './bet-catalog.js';

export interface BetPlacement {
  readonly seat: RouletteSeat;
  readonly bet: BetDefinition;
  readonly totalOnPosition: Chips;
}

export interface BetRefund {
  readonly seat: RouletteSeat;
  readonly refunded: Chips;
}

/**
 * Moteur de mises : résout la position visée via le graphe, puis valide les jetons contre les limites de table.
 * Mouvements immuables. Invariant tant que la roue n'a pas tourné : bankroll + Σ mises reste constant.
 */
export class RouletteBetManager {
  readonly #rules: RouletteRules;
  readonly #catalog: BetCatalog;

  constructor(rules: RouletteRules, catalog: BetCatalog = EUROPEAN_BET_CATALOG) {
    this.#rules = rules;
    this.#catalog = catalog;
  }

  totalStaked(seat: RouletteSeat): Chips {
    return sumChips(seat.bets.map((bet) => bet.amount));
  }

  /** Bornes d'une nouvelle pose ; le plafond par position, qui dépend de la position visée, est vérifié par placeBet. */
  betRange(seat: RouletteSeat): ChipRange | null {
    const { minBet, maxBetPerPosition, maxTotalBet } = this.#rules;
    const max = Math.min(maxBetPerPosition, maxTotalBet - this.totalStaked(seat), seat.bankroll);
    return max >= minBet ? { min: minBet, max: chips(max) } : null;
  }

  /** PLACE_BET est cumulatif : des jetons ajoutés sur une position déjà jouée s'additionnent. */
  placeBet(seat: RouletteSeat, selection: BetSelection, amount: number): Result<BetPlacement> {
    const resolved = this.#catalog.resolve(selection);
    if (!resolved.ok) return resolved;
    const bet = resolved.value;
    const { minBet, maxBetPerPosition, maxTotalBet } = this.#rules;

    if (!isChips(amount) || amount === 0) {
      return err(new EngineError('INVALID_AMOUNT', `Mise invalide : ${amount}`));
    }
    if (amount < minBet) {
      return err(new EngineError('BET_OUT_OF_LIMITS', `Mise minimale : ${minBet} jetons`, { minBet }));
    }
    if (amount > seat.bankroll) {
      return err(new EngineError('INSUFFICIENT_FUNDS', `Mise de ${amount} supérieure au solde`, { bankroll: seat.bankroll }));
    }

    const existing = seat.bets.find((placed) => placed.betId === bet.id);
    const totalOnPosition = chips((existing?.amount ?? 0) + amount);
    if (totalOnPosition > maxBetPerPosition) {
      return err(
        new EngineError('BET_OUT_OF_LIMITS', `Plafond de ${maxBetPerPosition} jetons dépassé sur ${bet.label}`, {
          maxBetPerPosition,
          totalOnPosition,
        }),
      );
    }
    if (this.totalStaked(seat) + amount > maxTotalBet) {
      return err(new EngineError('BET_OUT_OF_LIMITS', `Plafond de ${maxTotalBet} jetons misés par tour dépassé`, { maxTotalBet }));
    }

    const placed: PlacedBet = { betId: bet.id, amount: totalOnPosition };
    const bets = existing === undefined ? [...seat.bets, placed] : seat.bets.map((b) => (b.betId === bet.id ? placed : b));
    return ok({ seat: { ...seat, bankroll: subtractChips(seat.bankroll, amount), bets }, bet, totalOnPosition });
  }

  removeBet(seat: RouletteSeat, betId: BetId): Result<BetRefund> {
    const existing = seat.bets.find((placed) => placed.betId === betId);
    if (existing === undefined) {
      return err(new EngineError('ILLEGAL_ACTION', `Aucun jeton sur la position ${betId}`));
    }
    return ok({
      seat: { ...seat, bankroll: addChips(seat.bankroll, existing.amount), bets: seat.bets.filter((b) => b.betId !== betId) },
      refunded: existing.amount,
    });
  }

  clearBets(seat: RouletteSeat): BetRefund {
    const refunded = this.totalStaked(seat);
    return { seat: { ...seat, bankroll: addChips(seat.bankroll, refunded), bets: [] }, refunded };
  }
}
