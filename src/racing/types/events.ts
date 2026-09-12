import type { Chips } from '../../core/index.js';
import type { PlacedRaceBet, RaceBetSettlement, RaceCard, RaceResult } from './race.js';

export type RacingEvent =
  | { readonly type: 'RACE_CARD_PUBLISHED'; readonly card: RaceCard }
  | { readonly type: 'BET_PLACED'; readonly bet: PlacedRaceBet; readonly bankroll: Chips }
  | { readonly type: 'BET_CANCELLED'; readonly betId: string; readonly refunded: Chips; readonly bankroll: Chips }
  | { readonly type: 'BETS_CLEARED'; readonly refunded: Chips; readonly bankroll: Chips }
  | { readonly type: 'RACE_STARTED'; readonly raceNumber: number }
  | { readonly type: 'RACE_FINISHED'; readonly raceNumber: number; readonly result: RaceResult }
  | { readonly type: 'BET_SETTLED'; readonly settlement: RaceBetSettlement }
  | { readonly type: 'WINNINGS_PAID'; readonly amount: Chips; readonly bankroll: Chips };
