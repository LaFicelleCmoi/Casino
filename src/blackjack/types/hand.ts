import type { Card, Chips, SeatIndex } from '../../core/index.js';

declare const handIdBrand: unique symbol;

export type HandId = string & { readonly [handIdBrand]: 'HandId' };

export type PlayerHandStatus =
  | 'PLAYING' // peut encore recevoir une action
  | 'STOOD'
  | 'BUSTED'
  | 'BLACKJACK' // 21 naturel en 2 cartes, hors split
  | 'DOUBLED' // a reçu son unique carte après Double Down
  | 'SURRENDERED';

/**
 * Une main de joueur. Un split crée une nouvelle instance PlayerHand indépendante (mise, cartes, statut propres),
 * insérée juste après la main d'origine dans BlackjackSeat.hands.
 */
export interface PlayerHand {
  readonly id: HandId;
  readonly cards: readonly Card[];
  /** Mise totale engagée sur cette main (doublée après DOUBLE_DOWN). */
  readonly bet: Chips;
  readonly status: PlayerHandStatus;
  /** true si la main provient d'un split. */
  readonly fromSplit: boolean;
  readonly isSplitAces: boolean;
  /** Case d'origine (0 pour la première) : une main issue d'un split garde la case de la main splittée. */
  readonly box: number;
}

/** Score calculé par l'évaluateur (Étape 3) : jamais stocké dans l'état, pour qu'il ne puisse pas se désynchroniser. */
export interface BlackjackScore {
  /** Meilleur total : un As vaut 11 tant que cela ne fait pas dépasser 21. */
  readonly total: number;
  /** true si un As compte actuellement pour 11 (ex : A+6 = soft 17). */
  readonly isSoft: boolean;
  readonly isBust: boolean;
  readonly isBlackjack: boolean;
}

export interface DealerHand {
  /** cards[0] = carte visible, cards[1] = hole card tant que holeCardRevealed est false. */
  readonly cards: readonly Card[];
  readonly holeCardRevealed: boolean;
}

export type HandOutcome = 'BLACKJACK' | 'WIN' | 'PUSH' | 'LOSS' | 'SURRENDER';

export interface HandSettlement {
  readonly seatIndex: SeatIndex;
  readonly handId: HandId;
  readonly outcome: HandOutcome;
  readonly playerScore: BlackjackScore;
  readonly dealerScore: BlackjackScore;
  readonly stake: Chips;
  /** Rendu au bankroll, mise incluse : LOSS 0, PUSH stake, WIN 2×stake, BLACKJACK stake + ⌊stake×3/2⌋, SURRENDER ⌊stake/2⌋. */
  readonly returned: Chips;
}

export interface InsuranceSettlement {
  readonly seatIndex: SeatIndex;
  readonly stake: Chips;
  /** 3×stake si le croupier a Blackjack, sinon 0. */
  readonly returned: Chips;
}
