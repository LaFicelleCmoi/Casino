import type { Card, Chips, PlayerProfile, SeatIndex, ShoeState } from '../../core/index.js';
import type { HoldemRules } from '../rules.js';
import type { PokerBettingActionType } from './actions.js';
import type { EvaluatedHand, FiveCards, HoleCards } from './hand-rank.js';
import type { PotAward } from './pot.js';

/*
 * Machine à états (SHOWDOWN est transitoire, résolu dans le même `apply`) :
 *
 *   WAITING ──START_HAND──▶ PREFLOP ──▶ FLOP ──▶ TURN ──▶ RIVER ──▶ (SHOWDOWN) ──▶ HAND_COMPLETE
 *                              │          │        │        │                            │
 *                              └──────────┴────────┴────────┴── un seul joueur restant ──┘
 *
 *   Tous all-in (ou un seul joueur pouvant encore miser) : le board restant est déroulé automatiquement jusqu'au showdown.
 *   HAND_COMPLETE ──START_HAND──▶ PREFLOP (bouton avancé) ou WAITING si pas assez de joueurs.
 */

export const STREETS = ['PREFLOP', 'FLOP', 'TURN', 'RIVER'] as const;
export type Street = (typeof STREETS)[number];

interface BoardByStreet {
  readonly PREFLOP: readonly [];
  readonly FLOP: readonly [Card, Card, Card];
  readonly TURN: readonly [Card, Card, Card, Card];
  readonly RIVER: FiveCards;
}

/** Le nombre de cartes du board est lié à la street par le typage : un TURN à 3 cartes ne compile pas. */
export type BoardFor<S extends Street> = BoardByStreet[S];
export type Board = BoardByStreet[Street];

export type PokerSeatStatus =
  | 'SITTING_OUT' // assis mais ne reçoit pas de cartes
  | 'IN_HAND'
  | 'FOLDED'
  | 'ALL_IN';

export interface PokerSeat {
  readonly seatIndex: SeatIndex;
  readonly player: PlayerProfile;
  /** Jetons devant le joueur, hors mises engagées. */
  readonly stack: Chips;
  readonly status: PokerSeatStatus;
  readonly holeCards: HoleCards | null;
  /** Engagé sur la street courante. */
  readonly streetBet: Chips;
  /** Engagé sur toute la main : base du calcul des side pots. */
  readonly totalCommitted: Chips;
  /**
   * A parlé volontairement sur cette street (poster une blinde ne compte pas : c'est l'option de la big blind).
   * Droit de relance (règle TDA) : ne pas avoir parlé, OU faire face à au moins une relance complète depuis sa dernière
   * action, soit currentBet - streetBet ≥ minRaise. Un all-in court isolé ne rouvre donc pas l'action ; plusieurs cumulés, si.
   */
  readonly hasActed: boolean;
  readonly lastAction: PokerBettingActionType | null;
}

export interface BlindPositions {
  readonly smallBlind: SeatIndex;
  readonly bigBlind: SeatIndex;
}

export interface BettingRound {
  readonly toAct: SeatIndex;
  /** Mise la plus haute engagée sur cette street. */
  readonly currentBet: Chips;
  /** Incrément de la dernière relance complète (≥ big blind). Relance minimale = currentBet + minRaise. */
  readonly minRaise: Chips;
  readonly lastAggressor: SeatIndex | null;
}

export interface HoldemTableBase {
  readonly rules: HoldemRules;
  readonly handNumber: number;
  /** Longueur fixe = rules.seatCount ; null = siège libre. */
  readonly seats: readonly (PokerSeat | null)[];
  readonly buttonSeat: SeatIndex | null;
}

export interface WaitingPhase extends HoldemTableBase {
  readonly phase: 'WAITING';
}

export type StreetPhase<S extends Street> = HoldemTableBase & {
  readonly phase: S;
  readonly buttonSeat: SeatIndex;
  readonly blinds: BlindPositions;
  readonly deck: ShoeState;
  readonly board: BoardFor<S>;
  readonly betting: BettingRound;
};

/** Union discriminée PREFLOP | FLOP | TURN | RIVER, chacune avec son board typé. */
export type HandInProgress = { [S in Street]: StreetPhase<S> }[Street];

export interface ShowdownEntry {
  readonly seatIndex: SeatIndex;
  readonly holeCards: HoleCards;
  readonly hand: EvaluatedHand;
}

export type HoldemHandOutcome =
  | { readonly kind: 'UNCONTESTED'; readonly winner: SeatIndex; readonly awards: readonly PotAward[] }
  | { readonly kind: 'SHOWDOWN'; readonly showdown: readonly ShowdownEntry[]; readonly awards: readonly PotAward[] };

export interface HandCompletePhase extends HoldemTableBase {
  readonly phase: 'HAND_COMPLETE';
  readonly buttonSeat: SeatIndex;
  readonly board: Board;
  readonly outcome: HoldemHandOutcome;
}

export type HoldemState = WaitingPhase | HandInProgress | HandCompletePhase;

export type HoldemPhase = HoldemState['phase'];
