import type { Chips, PlayerId } from '../../core/index.js';
import type { RacingRules } from '../rules.js';
import type { PlacedRaceBet, RaceBetSettlement, RaceCard, RaceResult } from './race.js';

/*
 * Machine à états d'une réunion de courses :
 *
 *   BETTING ──START_RACE──▶ FINISHED ──NEXT_RACE──▶ BETTING (course suivante)
 *
 * L'arrivée est tirée dès la programmation (sealedResult) et reste invisible dans la vue jusqu'au départ.
 */

export interface RacingPlayer {
  readonly id: PlayerId;
  readonly bankroll: Chips;
}

export interface RacingBase {
  readonly rules: RacingRules;
  readonly player: RacingPlayer;
  readonly card: RaceCard;
  /** Nombre de paris enregistrés sur la course (sert aux identifiants). */
  readonly betCounter: number;
}

export interface RacingBettingPhase extends RacingBase {
  readonly phase: 'BETTING';
  readonly bets: readonly PlacedRaceBet[];
  readonly sealedResult: RaceResult;
}

export interface RacingFinishedPhase extends RacingBase {
  readonly phase: 'FINISHED';
  readonly result: RaceResult;
  readonly settlements: readonly RaceBetSettlement[];
  /** Σ gains − Σ mises de la course. */
  readonly net: number;
}

export type RacingState = RacingBettingPhase | RacingFinishedPhase;

export type RacingPhase = RacingState['phase'];
