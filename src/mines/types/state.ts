import type { Chips, PlayerId } from '../../core/index.js';
import type { MinesRules } from '../rules.js';

/*
 * Machine à états :
 *
 *   IDLE ──START_ROUND──▶ PLAYING ──REVEAL (diamant)──▶ PLAYING
 *                            │ REVEAL (bombe) / CASH_OUT / tous les diamants trouvés
 *                            ▼
 *                          IDLE (lastRound)
 */

export interface MinesPlayer {
  readonly id: PlayerId;
  readonly bankroll: Chips;
}

export interface MinesRound {
  readonly stake: Chips;
  readonly mineCount: number;
  /** Cases piégées (0 à 24, ligne par ligne), tirées au départ et jamais visibles avant la fin de la partie. */
  readonly mines: readonly number[];
  /** Cases explorées, dans l'ordre. */
  readonly revealed: readonly number[];
  /** Multiplicateur courant en centièmes. */
  readonly multiplier: number;
}

export interface MinesRoundResult {
  readonly stake: Chips;
  readonly mineCount: number;
  readonly mines: readonly number[];
  readonly revealed: readonly number[];
  readonly outcome: 'BUSTED' | 'CASHED_OUT';
  /** Bombe qui a explosé, le cas échéant. */
  readonly hitMine: number | null;
  readonly multiplier: number;
  readonly payout: Chips;
  readonly net: number;
}

export interface MinesBase {
  readonly rules: MinesRules;
  readonly player: MinesPlayer;
  readonly roundsPlayed: number;
}

export interface MinesIdlePhase extends MinesBase {
  readonly phase: 'IDLE';
  readonly lastRound: MinesRoundResult | null;
}

export interface MinesPlayingPhase extends MinesBase {
  readonly phase: 'PLAYING';
  readonly round: MinesRound;
}

export type MinesState = MinesIdlePhase | MinesPlayingPhase;
export type MinesPhase = MinesState['phase'];
