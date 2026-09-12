import type { Chips, PlayerId, SeatIndex } from '../../core/index.js';
import type { BetId, BetKind } from './bet.js';

export interface BetResult {
  readonly betId: BetId;
  readonly kind: BetKind;
  readonly label: string;
  readonly stake: Chips;
  readonly won: boolean;
  /** Rendu au joueur : mise + mise × rapport si la mise gagne, 0 sinon. */
  readonly returned: Chips;
  /** returned − stake : gain net si positif, −stake si la mise est perdue. */
  readonly net: number;
}

/** Règlement d'un ensemble de mises pour un numéro gagnant. */
export interface SpinSettlement {
  readonly totalStaked: Chips;
  readonly totalReturned: Chips;
  /** Bilan du tour : totalReturned − totalStaked. */
  readonly net: number;
  readonly bets: readonly BetResult[];
}

export interface SeatSettlement extends SpinSettlement {
  readonly seatIndex: SeatIndex;
  readonly playerId: PlayerId;
  readonly bankrollAfter: Chips;
}
