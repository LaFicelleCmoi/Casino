import type { Chips } from '../../core/index.js';
import type { PachinkoBall } from './state.js';

export type PachinkoEvent =
  | { readonly type: 'BALL_LANDED'; readonly ball: PachinkoBall; readonly bankroll: Chips }
  | { readonly type: 'FEVER_STARTED'; readonly balls: number; readonly stake: Chips }
  | { readonly type: 'FEVER_ENDED' };
