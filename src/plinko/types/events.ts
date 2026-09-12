import type { Chips } from '../../core/index.js';
import type { Volatility } from '../board.js';
import type { PlinkoDrop } from './state.js';

export type PlinkoEvent =
  | { readonly type: 'VOLATILITY_CHANGED'; readonly volatility: Volatility }
  | { readonly type: 'BALL_DROPPED'; readonly drop: PlinkoDrop; readonly bankroll: Chips };
