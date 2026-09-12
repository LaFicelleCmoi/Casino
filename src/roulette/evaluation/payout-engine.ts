import { ZERO_CHIPS, chips, invariant, sumChips } from '../../core/index.js';
import { EUROPEAN_BET_CATALOG, type BetCatalog } from '../betting/bet-catalog.js';
import type { PlacedBet } from '../types/bet.js';
import type { BetResult, SpinSettlement } from '../types/settlement.js';
import type { RouletteNumber } from '../wheel/pockets.js';

/**
 * Payout Engine : fonction pure (numéro gagnant, mises actives) → règlement du tour.
 * Une mise gagne si et seulement si le graphe indique qu'elle couvre le numéro sorti ; elle rend alors
 * mise × (rapport + 1). La règle du zéro n'a pas de cas particulier ici : aucune mise externe ne couvre le 0
 * (invariant du catalogue), elles sont donc toutes perdantes quand il sort.
 */
export class PayoutEngine {
  readonly #catalog: BetCatalog;

  constructor(catalog: BetCatalog = EUROPEAN_BET_CATALOG) {
    this.#catalog = catalog;
  }

  evaluateBet(bet: PlacedBet, winningNumber: RouletteNumber): BetResult {
    const definition = this.#catalog.get(bet.betId);
    invariant(definition !== undefined, `Position inconnue du graphe des mises : ${bet.betId}`);

    const won = definition.covers.includes(winningNumber);
    const gross = bet.amount * (definition.payout + 1);
    invariant(Number.isSafeInteger(gross), `Dépassement de capacité : ${bet.amount} × ${definition.payout + 1}`);
    const returned = won ? chips(gross) : ZERO_CHIPS;

    return {
      betId: definition.id,
      kind: definition.kind,
      label: definition.label,
      stake: bet.amount,
      won,
      returned,
      net: returned - bet.amount,
    };
  }

  /** Balaye toutes les mises actives d'un joueur et totalise le tour. */
  settle(bets: readonly PlacedBet[], winningNumber: RouletteNumber): SpinSettlement {
    const results = bets.map((bet) => this.evaluateBet(bet, winningNumber));
    const totalStaked = sumChips(results.map((result) => result.stake));
    const totalReturned = sumChips(results.map((result) => result.returned));
    return { totalStaked, totalReturned, net: totalReturned - totalStaked, bets: results };
  }
}
