import type { Chips, PlayerId } from '../../core/index.js';
import type { HiloCard, HiloDirection } from '../cards.js';
import type { HiloRules } from '../rules.js';

/*
 * Machine à états :
 *
 *   IDLE ──START_ROUND──▶ PLAYING ──GUESS gagné / JOKER──▶ PLAYING
 *                            │ GUESS perdu / CASH_OUT / multiplicateur maximal
 *                            ▼
 *                          IDLE (lastRound)
 */

export type HiloAction = HiloDirection | 'JOKER';

export interface HiloStep {
  readonly from: HiloCard;
  readonly to: HiloCard;
  readonly action: HiloAction;
  readonly won: boolean;
  /** Multiplicateur de série après ce coup, en centièmes. */
  readonly multiplier: number;
}

export interface HiloRound {
  readonly stake: Chips;
  readonly current: HiloCard;
  /** Carte suivante, déjà tirée et jamais visible avant d'être jouée. */
  readonly next: HiloCard;
  readonly multiplier: number;
  readonly streak: number;
  readonly jokersLeft: number;
  readonly steps: readonly HiloStep[];
}

export interface HiloRoundResult {
  readonly stake: Chips;
  readonly steps: readonly HiloStep[];
  readonly outcome: 'LOST' | 'CASHED_OUT';
  readonly multiplier: number;
  readonly streak: number;
  readonly payout: Chips;
  readonly net: number;
  readonly lastCard: HiloCard;
}

export interface HiloBase {
  readonly rules: HiloRules;
  readonly player: { readonly id: PlayerId; readonly bankroll: Chips };
  readonly roundsPlayed: number;
}

export interface HiloIdlePhase extends HiloBase {
  readonly phase: 'IDLE';
  readonly lastRound: HiloRoundResult | null;
}

export interface HiloPlayingPhase extends HiloBase {
  readonly phase: 'PLAYING';
  readonly round: HiloRound;
}

export type HiloState = HiloIdlePhase | HiloPlayingPhase;
export type HiloPhase = HiloState['phase'];
