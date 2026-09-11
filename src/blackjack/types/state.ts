import type { Chips, PlayerProfile, SeatIndex, ShoeState } from '../../core/index.js';
import type { BlackjackRules } from '../rules.js';
import type { DealerHand, HandSettlement, InsuranceSettlement, PlayerHand } from './hand.js';

/*
 * Machine à états (les phases transitoires DEALING, DEALER_TURN et SETTLEMENT sont résolues
 * à l'intérieur d'un seul `apply` et n'existent donc jamais dans un état persisté) :
 *
 *   BETTING ──DEAL──▶ (DEALING) ─┬─ As visible + assurance ──▶ INSURANCE ─┐
 *                                └───────────────────────────────────────┤
 *                                          (peek) Blackjack croupier ────┼──▶ ROUND_OVER
 *                                                                        ▼
 *                                   PLAYER_TURNS ──toutes mains finies──▶ (DEALER_TURN) ▶ (SETTLEMENT) ▶ ROUND_OVER
 *
 *   ROUND_OVER ──NEXT_ROUND──▶ BETTING   (remélange si la carte de coupe a été atteinte)
 */

export type SeatInsurance =
  | { readonly status: 'NOT_OFFERED' }
  | { readonly status: 'PENDING' }
  | { readonly status: 'DECLINED' }
  | { readonly status: 'TAKEN'; readonly stake: Chips };

export interface BlackjackSeat {
  readonly seatIndex: SeatIndex;
  readonly player: PlayerProfile;
  /** Jetons disponibles. Toute mise en est débitée dès qu'elle est posée : bankroll + jetons en jeu reste constant. */
  readonly bankroll: Chips;
  /** Mise posée pendant BETTING, convertie en première main à la distribution. */
  readonly pendingBet: Chips;
  /** Mains parallèles, dans l'ordre de jeu : 1 à la donne, jusqu'à rules.maxHandsPerSeat après splits. */
  readonly hands: readonly PlayerHand[];
  readonly insurance: SeatInsurance;
}

/** Désigne la main qui doit agir. */
export interface HandCursor {
  readonly seatIndex: SeatIndex;
  readonly handIndex: number;
}

export interface BlackjackTableBase {
  readonly rules: BlackjackRules;
  readonly roundNumber: number;
  readonly shoe: ShoeState;
  /** Longueur fixe = rules.seatCount ; null = siège libre. */
  readonly seats: readonly (BlackjackSeat | null)[];
  readonly dealer: DealerHand;
}

export interface BettingPhase extends BlackjackTableBase {
  readonly phase: 'BETTING';
}

export interface InsurancePhase extends BlackjackTableBase {
  readonly phase: 'INSURANCE';
}

/** Le curseur n'existe QUE dans cette phase : impossible par construction d'agir sur une main hors tour de jeu. */
export interface PlayerTurnsPhase extends BlackjackTableBase {
  readonly phase: 'PLAYER_TURNS';
  readonly cursor: HandCursor;
}

export interface RoundOverPhase extends BlackjackTableBase {
  readonly phase: 'ROUND_OVER';
  readonly dealerHadBlackjack: boolean;
  readonly settlements: readonly HandSettlement[];
  readonly insuranceSettlements: readonly InsuranceSettlement[];
}

export type BlackjackState = BettingPhase | InsurancePhase | PlayerTurnsPhase | RoundOverPhase;

export type BlackjackPhase = BlackjackState['phase'];
