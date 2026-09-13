import type { BigChips, PlayerProfile, SeatIndex } from '../../core/index.js';
import type { RouletteRules } from '../rules.js';
import type { RouletteNumber, SpinOutcome } from '../wheel/pockets.js';
import type { WheelSpin } from '../wheel/roulette-wheel.js';
import type { PlacedBet } from './bet.js';
import type { SeatSettlement } from './settlement.js';

/*
 * Machine à états (le lancer et le règlement sont résolus dans le même `apply`) :
 *
 *   BETTING ──CLOSE_BETS──▶ NO_MORE_BETS ──SPIN──▶ RESULT ──NEXT_ROUND──▶ BETTING
 *   « Faites vos jeux »     « Rien ne va plus »    numéro annoncé, gains payés
 */

export interface RouletteSeat {
  readonly seatIndex: SeatIndex;
  readonly player: PlayerProfile;
  /** Jetons disponibles. Toute mise en est débitée dès la pose : bankroll + Σ bets reste constant jusqu'au lancer. */
  readonly bankroll: BigChips;
  /** Mises du tour en cours ; vidées au règlement (le détail est conservé dans les settlements). */
  readonly bets: readonly PlacedBet[];
}

export interface RouletteTableBase {
  readonly rules: RouletteRules;
  /** Nombre de lancers effectués. */
  readonly roundNumber: number;
  /** Longueur fixe = rules.seatCount ; null = siège libre. */
  readonly seats: readonly (RouletteSeat | null)[];
  /** Derniers numéros sortis, le plus récent en tête (tableau d'affichage). */
  readonly history: readonly RouletteNumber[];
}

export interface RouletteBettingPhase extends RouletteTableBase {
  readonly phase: 'BETTING';
}

export interface RouletteNoMoreBetsPhase extends RouletteTableBase {
  readonly phase: 'NO_MORE_BETS';
}

export interface RouletteResultPhase extends RouletteTableBase {
  readonly phase: 'RESULT';
  readonly spin: WheelSpin;
  readonly outcome: SpinOutcome;
  /** Un règlement par joueur ayant misé. */
  readonly settlements: readonly SeatSettlement[];
}

export type RouletteState = RouletteBettingPhase | RouletteNoMoreBetsPhase | RouletteResultPhase;

export type RoulettePhase = RouletteState['phase'];
