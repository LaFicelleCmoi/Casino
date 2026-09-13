import type { BigChips, PlayerId, SeatIndex } from '../../core/index.js';
import type { SpinOutcome } from '../wheel/pockets.js';
import type { WheelSpin } from '../wheel/roulette-wheel.js';
import type { BetId } from './bet.js';
import type { SeatSettlement } from './settlement.js';

/** Événements émis par le moteur, dans l'ordre chronologique : une UI les rejoue pour animer la table. */
export type RouletteEvent =
  | { readonly type: 'PLAYER_SAT_DOWN'; readonly seatIndex: SeatIndex; readonly playerId: PlayerId; readonly bankroll: BigChips }
  | { readonly type: 'PLAYER_LEFT'; readonly seatIndex: SeatIndex; readonly playerId: PlayerId; readonly bankroll: BigChips }
  | {
      readonly type: 'BET_PLACED';
      readonly seatIndex: SeatIndex;
      readonly betId: BetId;
      readonly amount: BigChips;
      readonly totalOnPosition: BigChips;
    }
  | { readonly type: 'BET_REMOVED'; readonly seatIndex: SeatIndex; readonly betId: BetId; readonly refunded: BigChips }
  | { readonly type: 'BETS_CLEARED'; readonly seatIndex: SeatIndex; readonly refunded: BigChips }
  | { readonly type: 'BETS_CLOSED' }
  | { readonly type: 'WHEEL_SPUN'; readonly spin: WheelSpin; readonly outcome: SpinOutcome }
  | { readonly type: 'SEAT_SETTLED'; readonly settlement: SeatSettlement }
  | { readonly type: 'ROUND_ENDED'; readonly roundNumber: number }
  | { readonly type: 'BETTING_OPENED' };
