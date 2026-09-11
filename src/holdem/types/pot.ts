import type { Chips, SeatIndex } from '../../core/index.js';
import type { EvaluatedHand } from './hand-rank.js';

/**
 * Les pots ne sont PAS stockés dans l'état : ils sont dérivés des contributions (PokerSeat.totalCommitted).
 * Une seule source de vérité, donc aucun écart possible entre jetons misés et pots affichés.
 *
 * Exemple multi-all-in : A engage 50 (all-in), B 120 (all-in), C 200, D 200 (fold)
 *   pot 0 : 4 × 50  = 200 → éligibles A, B, C
 *   pot 1 : 3 × 70  = 210 → éligibles B, C
 *   pot 2 : 2 × 80  = 160 → éligible C seul (D a foldé mais sa contribution reste dans les pots)
 */
export interface Pot {
  readonly amount: Chips;
  /** Sièges non foldés ayant contribué jusqu'au niveau de ce pot. */
  readonly eligibleSeats: readonly SeatIndex[];
}

export interface PotShare {
  readonly seatIndex: SeatIndex;
  readonly amount: Chips;
}

export interface PotAward {
  /** 0 = pot principal, 1+ = side pots. */
  readonly potIndex: number;
  readonly amount: Chips;
  /** null si le pot est remporté sans showdown. */
  readonly winningHand: EvaluatedHand | null;
  /** Somme des parts = amount. Plusieurs parts en cas d'égalité parfaite. */
  readonly shares: readonly PotShare[];
}
