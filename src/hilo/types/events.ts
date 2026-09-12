import type { Chips } from '../../core/index.js';
import type { HiloCard } from '../cards.js';
import type { HiloAction } from './state.js';

export type HiloEvent =
  | { readonly type: 'ROUND_STARTED'; readonly card: HiloCard; readonly stake: Chips; readonly bankroll: Chips }
  | { readonly type: 'CARD_TURNED'; readonly card: HiloCard; readonly action: HiloAction; readonly won: boolean; readonly multiplier: number }
  | { readonly type: 'ROUND_LOST'; readonly card: HiloCard }
  | { readonly type: 'CASHED_OUT'; readonly multiplier: number; readonly payout: Chips; readonly bankroll: Chips };
