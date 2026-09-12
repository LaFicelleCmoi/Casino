import type { Chips } from '../../core/index.js';

export type MinesEvent =
  | { readonly type: 'ROUND_STARTED'; readonly stake: Chips; readonly mineCount: number; readonly bankroll: Chips }
  | { readonly type: 'DIAMOND_FOUND'; readonly tile: number; readonly multiplier: number }
  | { readonly type: 'MINE_HIT'; readonly tile: number; readonly mines: readonly number[] }
  | { readonly type: 'CASHED_OUT'; readonly multiplier: number; readonly payout: Chips; readonly bankroll: Chips };
