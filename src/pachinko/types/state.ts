import type { Chips, PlayerId } from '../../core/index.js';
import type { PachinkoRules } from '../rules.js';

/*
 *   READY ──LAUNCH_BALL (777 sur une poche Bonus)──▶ FEVER ──FEVER_BALL × 10──▶ READY
 */

export interface PachinkoBall {
  readonly id: number;
  readonly stake: Chips;
  /** Bille gratuite du Fever Mode. */
  readonly free: boolean;
  readonly pocket: number;
  /** Multiplicateur effectif en centièmes (doublé en Fever). */
  readonly multiplier: number;
  readonly payout: Chips;
  /** Chiffres de la machine à sous, si la bille est tombée dans une poche Bonus hors Fever. */
  readonly slot: readonly [number, number, number] | null;
  readonly feverTriggered: boolean;
}

export interface PachinkoState {
  readonly phase: 'READY' | 'FEVER';
  readonly rules: PachinkoRules;
  readonly player: { readonly id: PlayerId; readonly bankroll: Chips };
  readonly feverBallsLeft: number;
  /** Mise de la bille qui a déclenché le Fever : chaque bille gratuite joue ce montant. */
  readonly feverStake: Chips;
  readonly ballsLaunched: number;
  /** Dernières billes, la plus récente en tête. */
  readonly lastBalls: readonly PachinkoBall[];
}

export type PachinkoPhase = PachinkoState['phase'];
