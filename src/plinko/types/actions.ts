import type { Chips, PhaseGuard, PlayerCommand } from '../../core/index.js';
import type { Volatility } from '../board.js';
import type { PlinkoPhase } from './state.js';

export type PlinkoCommand =
  | (PlayerCommand<'SET_VOLATILITY'> & { readonly volatility: Volatility })
  | (PlayerCommand<'DROP_BALL'> & { readonly stake: Chips });

export type PlinkoCommandType = PlinkoCommand['type'];

export const PLINKO_COMMAND_PHASES = {
  SET_VOLATILITY: ['READY'],
  DROP_BALL: ['READY'],
} as const satisfies PhaseGuard<PlinkoPhase, PlinkoCommandType>;
